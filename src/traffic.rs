use std::{
    collections::HashMap,
    net::IpAddr,
    time::{Duration, Instant},
};

use axum::http::HeaderMap;
use ipnet::IpNet;

use crate::store::{Error, Result};

#[derive(Default)]
pub struct TrustedProxies(Vec<IpNet>);

impl TrustedProxies {
    pub fn parse(value: &str) -> std::result::Result<Self, ipnet::AddrParseError> {
        value
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(str::parse)
            .collect::<std::result::Result<Vec<_>, _>>()
            .map(Self)
    }

    fn contains(&self, ip: IpAddr) -> bool {
        self.0.iter().any(|network| network.contains(&ip))
    }

    pub fn client_ip(&self, peer: IpAddr, headers: &HeaderMap) -> Result<IpAddr> {
        let peer = peer.to_canonical();
        if !self.contains(peer) {
            return Ok(peer);
        }

        let mut chain = Vec::new();
        for raw in headers.get_all("x-forwarded-for") {
            let raw = raw.to_str().map_err(|_| invalid_chain())?;
            for item in raw.split(',') {
                if chain.len() >= 32 {
                    return Err(invalid_chain());
                }
                chain.push(
                    item.trim()
                        .parse::<IpAddr>()
                        .map_err(|_| invalid_chain())?
                        .to_canonical(),
                );
            }
        }
        chain
            .into_iter()
            .rev()
            .find(|ip| !self.contains(*ip))
            .ok_or_else(invalid_chain)
    }
}

fn invalid_chain() -> Error {
    Error::invalid("The trusted proxy did not provide a valid client address.")
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Action {
    Login,
    Demo,
    Code,
    Verify,
    Password,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum Scope {
    Client(IpAddr),
    ClientAccount(IpAddr, String),
    Mailbox(String),
}

struct Window {
    start: Instant,
    count: u16,
}

#[derive(Default)]
pub struct Limits {
    entries: HashMap<(Action, Scope), Window>,
    next_cleanup: Option<Instant>,
}

const WINDOW: Duration = Duration::from_secs(300);
const MAX_ENTRIES: usize = 16_384;

impl Limits {
    pub fn take(&mut self, action: Action, ip: IpAddr, account: Option<&str>) -> Result<()> {
        let now = Instant::now();
        if self.next_cleanup.is_none_or(|next| now >= next) || self.entries.len() >= MAX_ENTRIES {
            self.entries
                .retain(|_, entry| now.duration_since(entry.start) < WINDOW);
            self.next_cleanup = Some(now + Duration::from_secs(30));
        }

        let (client_max, account_max) = match action {
            Action::Login => (120, 12),
            Action::Demo => (20, 0),
            Action::Code => (20, 4),
            Action::Verify => (60, 12),
            Action::Password => (60, 10),
        };
        let client = (action, Scope::Client(ip));
        self.check(&client, client_max, now)?;
        let account_key = account.map(|value| {
            let scope = if action == Action::Code {
                Scope::Mailbox(value.to_owned())
            } else {
                Scope::ClientAccount(ip, value.to_owned())
            };
            (action, scope)
        });
        if let Some(key) = account_key.as_ref() {
            self.check(key, account_max, now)?;
        }
        let new_keys = usize::from(!self.entries.contains_key(&client))
            + usize::from(
                account_key
                    .as_ref()
                    .is_some_and(|key| !self.entries.contains_key(key)),
            );
        if self.entries.len() + new_keys > MAX_ENTRIES {
            return Err(Error::limited());
        }
        self.record(client, now);
        if let Some(key) = account_key {
            self.record(key, now);
        }
        Ok(())
    }

    fn check(&self, key: &(Action, Scope), max: u16, now: Instant) -> Result<()> {
        if self
            .entries
            .get(key)
            .is_some_and(|entry| now.duration_since(entry.start) < WINDOW && entry.count >= max)
        {
            return Err(Error::limited());
        }
        Ok(())
    }

    fn record(&mut self, key: (Action, Scope), now: Instant) {
        let entry = self.entries.entry(key).or_insert(Window {
            start: now,
            count: 0,
        });
        if now.duration_since(entry.start) >= WINDOW {
            *entry = Window {
                start: now,
                count: 0,
            };
        }
        entry.count += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_headers_from_untrusted_peers_and_stops_at_nearest_untrusted_hop() {
        let trusted = TrustedProxies::parse("10.8.0.0/24, 2001:db8:1::/64").unwrap();
        let mut headers = HeaderMap::new();
        headers.append(
            "x-forwarded-for",
            "198.51.100.5, 203.0.113.8".parse().unwrap(),
        );
        headers.append("x-forwarded-for", "2001:db8:1::15".parse().unwrap());
        for (peer, expected) in [("192.0.2.5", "192.0.2.5"), ("10.8.0.2", "203.0.113.8")] {
            assert_eq!(
                trusted.client_ip(peer.parse().unwrap(), &headers).unwrap(),
                expected.parse::<IpAddr>().unwrap()
            );
        }
        assert!(
            trusted
                .client_ip("10.8.0.2".parse().unwrap(), &HeaderMap::new())
                .is_err()
        );
    }

    #[test]
    fn separates_demo_and_login_limits_and_scopes_login_by_ip_and_account() {
        let mut limits = Limits::default();
        let ip = "192.0.2.1".parse().unwrap();
        for _ in 0..20 {
            limits.take(Action::Demo, ip, None).unwrap();
        }
        assert!(limits.take(Action::Demo, ip, None).is_err());
        for _ in 0..12 {
            limits
                .take(Action::Login, ip, Some("one@example.com"))
                .unwrap();
        }
        assert!(
            limits
                .take(Action::Login, ip, Some("one@example.com"))
                .is_err()
        );
        limits
            .take(Action::Login, ip, Some("two@example.com"))
            .unwrap();
        limits
            .take(
                Action::Login,
                "192.0.2.2".parse().unwrap(),
                Some("one@example.com"),
            )
            .unwrap();
    }
}
