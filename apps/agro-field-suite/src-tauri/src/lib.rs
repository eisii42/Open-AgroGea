mod agro;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // Auto-update nativo (solo desktop: Windows/macOS/Linux). Su mobile gli
      // aggiornamenti passano dagli store, quindi i plugin updater/process NON
      // vengono compilati né registrati (vedi gate in Cargo.toml).
      #[cfg(desktop)]
      {
        // L'updater in Tauri v2 usa correttamente il pattern Builder
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        
        // Il plugin process richiede invece la funzione globale init()
        app.handle().plugin(tauri_plugin_process::init())?;
      }
      
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      agro::agro_store_offline_session,
      agro::agro_unlock_offline_session,
      agro::agro_store_connection_profile,
      agro::agro_push_mutations,
      agro::agro_pull_mutations,
      agro::agro_fetch_map_tile,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
