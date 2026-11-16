; electron-builder 自动引入（buildResources/installer.nsh）。
;
; 卸载时把开机自启那一项一起删掉。值名是 AppUserModelId（main/index.ts 里的
; setAppUserModelId），不删的话注册表里留一条指向已删除 exe 的启动项，
; 安全软件会把它报成「无效 / 可疑启动项」。
; 升级时旧版本的卸载程序也会跑一遍，这时不能删 —— 用户的开关得原样留着。
; 旧版用过的 com.unreal.agent 是虚幻盒子的值名，这里不碰，免得把虚幻盒子的开机自启删掉；
; 旧值由程序启动时 migrateLegacyLoginItem 认领并迁走。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.gdbox.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.gdbox.app"
  ${endIf}
!macroend
