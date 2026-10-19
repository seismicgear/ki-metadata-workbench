!macro customInstall
  ; Source-defined Array native adapter reads this standard uninstall record.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
!macroend
