// tether-app library entrypoint.
//
// Both the desktop binary (`main.rs`) and the mobile entrypoints
// (Tauri-generated `lib_main.rs` for Android/iOS) call `run()`.

mod wt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let wt_state = wt::WtState::default();

    tauri::Builder::default()
        .manage(wt_state)
        .invoke_handler(tauri::generate_handler![
            wt::wt_connect,
            wt::wt_open_bidi,
            wt::wt_open_uni,
            wt::wt_send,
            wt::wt_recv,
            wt::wt_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
