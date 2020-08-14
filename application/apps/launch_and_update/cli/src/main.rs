#![windows_subsystem = "windows"]

extern crate chrono;
extern crate dirs;
extern crate flate2;
#[macro_use]
extern crate log;
extern crate log4rs;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use anyhow::{anyhow, Result};
use base::{
    chipmunk_log_config, initialize_from_fresh_yml, setup_fallback_logging,
};
use std::{
    env,
    path::Path,
    process::{Child, Command},
};

fn init_logging() -> Result<()> {
    let log_config_path = chipmunk_log_config();
    let logging_correctly_initialized = if log_config_path.exists() {
        // log4rs.yaml exists, try to parse it
        match log4rs::init_file(&log_config_path, Default::default()) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("problems with existing log config ({}), write fresh", e);
                // log4rs.yaml exists, could not parse it
                initialize_from_fresh_yml().is_ok()
            }
        }
    } else {
        // log4rs.yaml did not exists
        initialize_from_fresh_yml().is_ok()
    };
    if !logging_correctly_initialized {
        setup_fallback_logging()?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn spawn(exe: &str, args: &[&str]) -> Result<Child> {
    Command::new(exe)
        .args(args)
        .spawn()
        .map_err(|e| anyhow!("{}", e))
}

#[cfg(target_os = "windows")]
fn spawn(exe: &str, args: &[&str]) -> Result<Child> {
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    Command::new(exe)
        .args(args)
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| anyhow!("{}", e))
}

/// on macos it looks like /xyz/chipmunk.app/Contents/MacOS/app
fn find_launcher() -> Result<String> {
    let root = std::env::current_exe()?;
    let root_path = Path::new(&root)
        .parent()
        .ok_or_else(|| anyhow!("no parent found"))?;
    let app = if cfg!(target_os = "windows") {
        format!("{}\\{}", root_path.display(), "chipmunk.exe")
    } else {
        format!("{}/{}", root_path.display(), "chipmunk")
    };
    Ok(app)
}

fn main() -> Result<()> {
    match init_logging() {
        Ok(()) => trace!("Launcher started logging"),
        Err(e) => eprintln!("couldn't initialize logging: {}", e),
    }

    let launcher = match find_launcher() {
        Ok(app) => app,
        Err(e) => {
            error!("path to executable not found: {}", e);
            std::process::exit(1);
        }
    };

    trace!("Target application: {}", launcher);

    let launcher_path = Path::new(&launcher);

    if !launcher_path.exists() {
        error!("launcher not found! {:?}", launcher_path);
        std::process::exit(1);
    }
    
    let pwd = env::current_dir().expect("Fail to detect current dir");
    let pwd = format!("pwd::{}::pwd", pwd.to_str().expect("Fail to convert current path to OS string"));
    let env_args = env::args().collect::<Vec<String>>();
    let mut args: Vec<&str> = vec![pwd.as_ref()];
    args.append(&mut env_args.iter().map(|a| a.as_ref()).collect::<Vec<&str>>());
    let child: Result<Child> = spawn(&launcher, args.iter().map(|a| a.as_ref()).collect::<Vec<&str>>().as_slice());
    match child {
        Ok(child) => {
            let pid = child.id();
            info!("Lancher is started (pid: {})", pid);
        }
        Err(e) => {
            error!("Failed to start launcher ({})", e);
        }
    };
    Ok(())
}