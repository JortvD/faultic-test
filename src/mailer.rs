use std::{env, net::IpAddr, time::Duration};

use axum::http::{HeaderMap, Uri, header, uri::Authority};

use lettre::{Address, Message, SmtpTransport, Transport, message::Mailbox};

use crate::store::{Error, Result};

pub struct Mailer {
    transport: SmtpTransport,
    from: Mailbox,
    capture_only: bool,
}

impl Mailer {
    pub fn from_env() -> std::result::Result<Option<Self>, Box<dyn std::error::Error>> {
        let (url, capture_only) = match env::var("FIELDLINE_SMTP_URL")
            .ok()
            .filter(|url| !url.is_empty())
        {
            Some(url) => (url, false),
            None => match env::var("FIELDLINE_CAPTURE_SMTP_URL")
                .ok()
                .filter(|url| !url.is_empty())
            {
                Some(url) => (url, true),
                None => return Ok(None),
            },
        };
        let from = if capture_only {
            "verification@fieldline.test".parse()?
        } else {
            env::var("FIELDLINE_SMTP_FROM")?.parse()?
        };
        if !capture_only {
            let parsed = url::Url::parse(&url).map_err(|_| "FIELDLINE_SMTP_URL is invalid")?;
            let tls = parsed
                .query_pairs()
                .find(|(key, _)| key == "tls")
                .map(|(_, value)| value);
            if parsed.scheme() != "smtps"
                && !(parsed.scheme() == "smtp" && tls.as_deref() == Some("required"))
            {
                return Err("FIELDLINE_SMTP_URL must require TLS".into());
            }
        }
        let transport = SmtpTransport::from_url(&url)
            .map_err(|_| "FIELDLINE_SMTP_URL is invalid")?
            .timeout(Some(Duration::from_secs(8)))
            .build();
        Ok(Some(Self {
            transport,
            from,
            capture_only,
        }))
    }

    pub fn allows_request(&self, headers: &HeaderMap, origin: Option<&str>) -> bool {
        if !self.capture_only {
            return true;
        }
        let local_origin = origin.is_none_or(|origin| {
            origin
                .parse::<Uri>()
                .is_ok_and(|uri| uri.host().is_some_and(loopback))
        });
        local_origin
            && headers
                .get(header::HOST)
                .and_then(|host| host.to_str().ok())
                .and_then(|host| host.parse::<Authority>().ok())
                .is_some_and(|host| loopback(host.host()))
    }

    pub fn verification_code(&self, to: Address, code: &str) -> Result<()> {
        let message = Message::builder()
            .from(self.from.clone())
            .to(Mailbox::new(None, to))
            .subject("Your Fieldline verification code")
            .body(format!(
                "Enter this verification code on the Fieldline signup page: {code}\r\n\r\nThe code expires in ten minutes. If you did not request it, you can ignore this message.\r\n"
            ))
            .map_err(|_| Error::unavailable("Fieldline could not send the verification email. Please try again."))?;
        self.transport.send(&message).map_err(|_| {
            eprintln!("Fieldline verification email delivery failed");
            Error::unavailable("Fieldline could not send the verification email. Please try again.")
        })?;
        Ok(())
    }
}

fn loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.to_canonical().is_loopback())
}
