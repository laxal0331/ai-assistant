@echo off
setlocal

cd /d "%~dp0"

echo Building AI Assistant release package...
echo Project: %cd%
echo.

echo Closing running AI Assistant processes...
tasklist /FI "IMAGENAME eq AI Assistant.exe" 2>nul | find /I "AI Assistant.exe" >nul
if not errorlevel 1 (
  taskkill /IM "AI Assistant.exe" >nul 2>nul
  timeout /t 3 /nobreak >nul
  tasklist /FI "IMAGENAME eq AI Assistant.exe" 2>nul | find /I "AI Assistant.exe" >nul
  if not errorlevel 1 (
    taskkill /F /IM "AI Assistant.exe" >nul 2>nul
    timeout /t 1 /nobreak >nul
  )
)
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm.cmd was not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo ERROR: csc.exe was not found. Please enable/install Microsoft .NET Framework.
  echo.
  pause
  exit /b 1
)

echo Building native screenshot helper...
if not exist "%cd%\electron\bin" mkdir "%cd%\electron\bin"
"%CSC%" /nologo /target:exe /optimize+ /out:"%cd%\electron\bin\native-capture.exe" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "%cd%\electron\native-capture\Program.cs"
if errorlevel 1 (
  echo.
  echo Native screenshot helper build failed. Check the messages above.
  echo.
  pause
  exit /b 1
)
echo.

call npm.cmd run dist
if errorlevel 1 (
  echo.
  echo Build failed. Check the messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo Build complete.
echo Output:
echo   %cd%\release\AI Assistant 1.0.0.exe
echo.
pause
