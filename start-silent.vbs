Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Efthimis\Documents\Project Browser\browser"
WshShell.Run "cmd /c npm start", 0, False
