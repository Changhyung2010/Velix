use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write as IoWrite};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

// PTY session management
struct PtySession {
    pair: PtyPair,
    writer: Box<dyn IoWrite + Send>,
}

// Simple in-memory storage for API keys and shell state
struct AppState {
    api_keys: Mutex<HashMap<String, String>>,
    shell_cwd: Mutex<String>,
    pty_sessions: Mutex<HashMap<String, Arc<Mutex<PtySession>>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCommit {
    hash: String,
    message: String,
    author: String,
    date: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorStats {
    name: String,
    commits: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEvolution {
    total_file_commits: usize,
    authors: Vec<AuthorStats>,
    timeline: Vec<GitCommit>,
    lines_added_total: usize,
    lines_removed_total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContributorStats {
    name: String,
    email: String,
    commits: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitRemoteInfo {
    remote_url: Option<String>,
    github_repo: Option<String>,
    github_url: Option<String>,
    contributors: Vec<ContributorStats>,
    total_commits: usize,
    first_commit_date: Option<String>,
    branches: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    cwd: String,
}

#[derive(Clone, Serialize)]
struct TerminalOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExit {
    session_id: String,
    exit_code: Option<i32>,
}

// ==================== PTY Terminal Commands ====================

#[tauri::command]
fn pty_create(
    session_id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system.openpty(size).map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Get the shell path - use user's default shell or fallback to zsh
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // Login shell to load user's profile

    // Set working directory
    let working_dir = cwd.unwrap_or_else(|| dirs_or_home());
    cmd.cwd(&working_dir);

    // Set environment variables
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("HOME", dirs_or_home());

    // Spawn the shell in the PTY
    let mut child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Get reader for output
    let mut reader = pair.master.try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    // Get writer for input
    let writer = pair.master.take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store the session
    let session = Arc::new(Mutex::new(PtySession {
        pair,
        writer,
    }));

    {
        let mut sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(session_id.clone(), session);
    }

    // Spawn thread to read output and emit events
    let app_handle = app.clone();
    let sid = session_id.clone();
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    // EOF - process exited
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_handle.emit("pty-output", TerminalOutput {
                        session_id: sid.clone(),
                        data,
                    });
                }
                Err(e) => {
                    eprintln!("PTY read error: {}", e);
                    break;
                }
            }
        }

        // Wait for child to exit and get exit code
        let exit_code = child.wait().ok().and_then(|s| {
            if s.success() { Some(0) } else { Some(1) }
        });

        let _ = app_handle.emit("pty-exit", TerminalExit {
            session_id: sid,
            exit_code,
        });
    });

    Ok(())
}

#[tauri::command]
fn pty_write(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;

    let session = sessions.get(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let mut session_guard = session.lock().map_err(|e| e.to_string())?;
    session_guard.writer.write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;
    session_guard.writer.flush()
        .map_err(|e| format!("Failed to flush PTY: {}", e))?;

    Ok(())
}

#[tauri::command]
fn pty_resize(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;

    let session = sessions.get(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let session_guard = session.lock().map_err(|e| e.to_string())?;
    session_guard.pair.master.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| format!("Failed to resize PTY: {}", e))?;

    Ok(())
}

#[tauri::command]
fn pty_kill(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().map_err(|e| e.to_string())?;

    if sessions.remove(&session_id).is_some() {
        Ok(())
    } else {
        Err(format!("PTY session not found: {}", session_id))
    }
}

// ==================== Legacy Shell Commands (for compatibility) ====================

#[tauri::command]
fn execute_shell_command(
    command: &str,
    cwd: Option<&str>,
    state: State<'_, AppState>,
) -> Result<ShellResult, String> {
    // Determine working directory
    let working_dir = if let Some(dir) = cwd {
        if !dir.is_empty() {
            dir.to_string()
        } else {
            state.shell_cwd.lock().map_err(|e| e.to_string())?.clone()
        }
    } else {
        state.shell_cwd.lock().map_err(|e| e.to_string())?.clone()
    };

    let working_path = Path::new(&working_dir);
    if !working_path.exists() {
        return Err(format!("Directory does not exist: {}", working_dir));
    }

    // Handle `cd` specially: update the tracked cwd
    let trimmed = command.trim();
    if trimmed == "cd" || trimmed.starts_with("cd ") {
        let target = if trimmed == "cd" {
            dirs_or_home()
        } else {
            let arg = trimmed[3..].trim();
            let arg = arg.trim_matches('"').trim_matches('\'');
            if arg == "~" {
                dirs_or_home()
            } else if arg == "-" {
                // Just go to home for simplicity
                dirs_or_home()
            } else if arg.starts_with('/') {
                arg.to_string()
            } else if arg.starts_with("~/") {
                let home = dirs_or_home();
                format!("{}/{}", home, &arg[2..])
            } else {
                format!("{}/{}", working_dir, arg)
            }
        };

        // Canonicalize the path
        let resolved = match std::fs::canonicalize(&target) {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(e) => {
                return Ok(ShellResult {
                    stdout: String::new(),
                    stderr: format!("cd: {}: {}", target, e),
                    exit_code: 1,
                    cwd: working_dir,
                });
            }
        };

        if !Path::new(&resolved).is_dir() {
            return Ok(ShellResult {
                stdout: String::new(),
                stderr: format!("cd: not a directory: {}", resolved),
                exit_code: 1,
                cwd: working_dir,
            });
        }

        *state.shell_cwd.lock().map_err(|e| e.to_string())? = resolved.clone();
        return Ok(ShellResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
            cwd: resolved,
        });
    }

    // Execute via /bin/zsh (macOS default shell)
    let output = Command::new("/bin/zsh")
        .args(&["-c", command])
        .current_dir(&working_dir)
        .env("HOME", dirs_or_home())
        .env("TERM", "xterm-256color")
        .env("LANG", "en_US.UTF-8")
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(ShellResult {
        stdout,
        stderr,
        exit_code,
        cwd: working_dir,
    })
}

#[tauri::command]
fn get_shell_cwd(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.shell_cwd.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn set_shell_cwd(cwd: &str, state: State<'_, AppState>) -> Result<(), String> {
    let path = Path::new(cwd);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Not a valid directory: {}", cwd));
    }
    *state.shell_cwd.lock().map_err(|e| e.to_string())? = cwd.to_string();
    Ok(())
}

fn dirs_or_home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn save_api_key(provider: &str, key: &str, state: State<'_, AppState>) -> Result<(), String> {
    let mut keys = state.api_keys.lock().map_err(|e| e.to_string())?;
    keys.insert(provider.to_string(), key.to_string());
    Ok(())
}

#[tauri::command]
fn get_api_key(provider: &str, state: State<'_, AppState>) -> Result<String, String> {
    let keys = state.api_keys.lock().map_err(|e| e.to_string())?;
    keys.get(provider)
        .cloned()
        .ok_or_else(|| format!("No API key found for provider: {}", provider))
}

#[tauri::command]
fn get_git_history(file_path: &str) -> Result<Vec<GitCommit>, String> {
    let path = Path::new(file_path);
    let parent = path.parent().unwrap_or(path);
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();

    let output = Command::new("git")
        .args(&[
            "log",
            "--pretty=format:%h|%s|%an|%ad",
            "--date=short",
            "-n",
            "50",
            "--",
            &file_name,
        ])
        .current_dir(parent)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new()); // Return empty logic if not a git repo or error
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 4 {
            commits.push(GitCommit {
                hash: parts[0].to_string(),
                message: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
            });
        }
    }

    Ok(commits)
}

#[tauri::command]
fn get_file_evolution(file_path: &str) -> Result<FileEvolution, String> {
    let path = Path::new(file_path);
    let parent = path.parent().unwrap_or(path);
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();

    // Get commit count
    let count_output = Command::new("git")
        .args(&["rev-list", "--count", "HEAD", "--", &*file_name])
        .current_dir(parent)
        .output()
        .map_err(|e| e.to_string())?;

    let total_commits = String::from_utf8_lossy(&count_output.stdout)
        .trim()
        .parse::<usize>()
        .unwrap_or(0);

    // Get authors stats
    let authors_output = Command::new("git")
        .args(&["shortlog", "-sn", "--", &*file_name])
        .current_dir(parent)
        .output()
        .map_err(|e| e.to_string())?;

    let authors_stdout = String::from_utf8_lossy(&authors_output.stdout);
    let mut authors = Vec::new();
    for line in authors_stdout.lines().take(5) {
        let parts: Vec<&str> = line.trim().split_whitespace().collect();
        if let Some(count_str) = parts.first() {
            if let Ok(count) = count_str.parse::<usize>() {
                let name = parts[1..].join(" ");
                authors.push(AuthorStats {
                    name,
                    commits: count,
                });
            }
        }
    }

    // Get timeline (reuse get_git_history logic roughly)
    let timeline = get_git_history(file_path)?;

    // Rough lines added/removed (using numstat)
    let stats_output = Command::new("git")
        .args(&["log", "--numstat", "--pretty=format:", "--", &*file_name])
        .current_dir(parent)
        .output()
        .map_err(|e| e.to_string())?;

    let stats_stdout = String::from_utf8_lossy(&stats_output.stdout);
    let mut added = 0;
    let mut removed = 0;

    for line in stats_stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            added += parts[0].parse::<usize>().unwrap_or(0);
            removed += parts[1].parse::<usize>().unwrap_or(0);
        }
    }

    Ok(FileEvolution {
        total_file_commits: total_commits,
        authors,
        timeline,
        lines_added_total: added,
        lines_removed_total: removed,
    })
}

#[tauri::command]
fn find_repo_root(file_path: &str) -> Result<String, String> {
    let path = Path::new(file_path);
    let parent = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };

    let output = Command::new("git")
        .args(&["rev-parse", "--show-toplevel"])
        .current_dir(parent)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Not a git repository".to_string())
    }
}

#[tauri::command]
fn get_git_remote_info(repo_path: &str) -> Result<GitRemoteInfo, String> {
    let path = Path::new(repo_path);

    // Remote URL
    let url_output = Command::new("git")
        .args(&["remote", "get-url", "origin"])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    let remote_url = if url_output.status.success() {
        Some(
            String::from_utf8_lossy(&url_output.stdout)
                .trim()
                .to_string(),
        )
    } else {
        None
    };

    let mut github_repo = None;
    let mut github_url = None;

    if let Some(url) = &remote_url {
        if url.contains("github.com") {
            let clean_url = url.trim().replace(".git", "");
            if let Some(idx) = clean_url.find("github.com") {
                let repo_part = &clean_url[idx + 11..]; // skip github.com/ or github.com:
                let repo_part = repo_part.trim_start_matches(|c| c == '/' || c == ':');
                github_repo = Some(repo_part.to_string());
                github_url = Some(format!("https://github.com/{}", repo_part));
            }
        }
    }

    // Contributors
    let contrib_output = Command::new("git")
        .args(&["shortlog", "-sne", "--all"])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    let contrib_stdout = String::from_utf8_lossy(&contrib_output.stdout);
    let mut contributors = Vec::new();

    for line in contrib_stdout.lines().take(10) {
        // Format:     34	Name <email@example.com>
        let parts: Vec<&str> = line.trim().split_whitespace().collect();
        if let Some(count_str) = parts.first() {
            if let Ok(count) = count_str.parse::<usize>() {
                let rest = parts[1..].join(" ");
                if let Some(start_email) = rest.find('<') {
                    if let Some(end_email) = rest.find('>') {
                        let name = rest[..start_email].trim().to_string();
                        let email = rest[start_email + 1..end_email].to_string();
                        contributors.push(ContributorStats {
                            name,
                            email,
                            commits: count,
                        });
                    }
                }
            }
        }
    }

    // Total commits
    let count_output = Command::new("git")
        .args(&["rev-list", "--count", "--all"])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    let total_commits = String::from_utf8_lossy(&count_output.stdout)
        .trim()
        .parse::<usize>()
        .unwrap_or(0);

    // First commit date
    let first_commit_output = Command::new("git")
        .args(&[
            "log",
            "--reverse",
            "--format=%ad",
            "--date=short",
            "-n",
            "1",
        ])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    let first_commit_date = if first_commit_output.status.success() {
        Some(
            String::from_utf8_lossy(&first_commit_output.stdout)
                .trim()
                .to_string(),
        )
    } else {
        None
    };

    Ok(GitRemoteInfo {
        remote_url,
        github_repo,
        github_url,
        contributors,
        total_commits,
        first_commit_date,
        branches: Vec::new(), // Skip branches for now to save time
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let home = dirs_or_home();
    tauri::Builder::default()
        .manage(AppState {
            api_keys: Mutex::new(HashMap::new()),
            shell_cwd: Mutex::new(home),
            pty_sessions: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_api_key,
            get_api_key,
            execute_shell_command,
            get_shell_cwd,
            set_shell_cwd,
            get_git_history,
            get_file_evolution,
            find_repo_root,
            get_git_remote_info,
            pty_create,
            pty_write,
            pty_resize,
            pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
