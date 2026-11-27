use std::{io, path::Path};

pub fn prepare(path: &Path) -> io::Result<()> {
    if path == Path::new(":memory:") {
        return Ok(());
    }
    if let Some(parent) = path.parent().filter(|path| !path.as_os_str().is_empty()) {
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(parent)?;
    }

    #[cfg(unix)]
    {
        restrict(path, true)?;
        for extension in ["-wal", "-shm", "-journal"] {
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(extension);
            match restrict(Path::new(&sidecar), false) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn restrict(path: &Path, create: bool) -> io::Result<()> {
    use std::{
        fs::{OpenOptions, Permissions},
        os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    };

    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.nlink() != 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Fieldline database files must be regular files with one link",
        ));
    }
    if metadata.permissions().mode() & 0o777 != 0o600 {
        file.set_permissions(Permissions::from_mode(0o600))?;
    }
    Ok(())
}
