
@echo off
setlocal EnableExtensions EnableDelayedExpansion

title TRUST-CV ^| SIH26228 ^| Zero-Trust CV Integrity Assurance
color 0A
cls

echo.
echo ================================================================================
echo    TRUST-CV  //  SIH26228
echo    Zero-Trust Computer Vision Integrity Assurance ^& Evidence Graph
echo    Phases 1-16 Full Stack Defense Suite ^(Air-Gapped Edition^)
echo ================================================================================
echo.

:: ============================================================================
:: Resolve paths relative to this .bat file
:: ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BLOCK_DIR=%ROOT%\Block-Sentinal"
set "BACKEND_DIR=%BLOCK_DIR%\backend"
set "FRONTEND_DIR=%ROOT%\frontend"
set "VENV_DIR=%ROOT%\.venv"

:: ============================================================================
:: Parse mode (dev | demo | test | build)
:: ============================================================================

set "MODE=dev"

if /I "%~1"=="demo"  set "MODE=demo"
if /I "%~1"=="test"  set "MODE=test"
if /I "%~1"=="build" set "MODE=build"

echo  Mode: %MODE%
echo.

:: ============================================================================
:: 1. Python runtime & virtual environment detection
:: ============================================================================

echo [1/6] Checking Python runtime ^& virtual environment...

set "PY_BIN="
set "PIP_BIN="

:: Check if dedicated project .venv exists
if exist "%VENV_DIR%\Scripts\python.exe" (
    set "PY_BIN=%VENV_DIR%\Scripts\python.exe"
    set "PIP_BIN=%VENV_DIR%\Scripts\pip.exe"
    echo       Using dedicated virtualenv: .venv
) else if exist "%BLOCK_DIR%\venv\Scripts\python.exe" (
    set "PY_BIN=%BLOCK_DIR%\venv\Scripts\python.exe"
    set "PIP_BIN=%BLOCK_DIR%\venv\Scripts\pip.exe"
    echo       Using Block-Sentinal virtualenv: Block-Sentinal\venv
) else (
    :: Verify system python is available
    python --version >nul 2>&1
    if errorlevel 1 (
        color 0C
        echo [ERROR] Python was not found in PATH.
        echo         Please install Python 3.10+ from python.org and check "Add to PATH".
        pause
        exit /b 1
    )
    
    echo       Creating dedicated virtual environment at .venv...
    python -m venv "%VENV_DIR%"
    if exist "%VENV_DIR%\Scripts\python.exe" (
        set "PY_BIN=%VENV_DIR%\Scripts\python.exe"
        set "PIP_BIN=%VENV_DIR%\Scripts\pip.exe"
        echo       Created and activated .venv
    ) else (
        set "PY_BIN=python"
        set "PIP_BIN=pip"
        echo       Using system Python fallback
    )
)

for /f "tokens=*" %%v in ('"%PY_BIN%" --version 2^>^&1') do set "PY_VER=%%v"
echo       %PY_VER%

:: ============================================================================
:: 2. Backend dependency verification
:: ============================================================================

echo [2/6] Verifying backend dependencies...

"%PY_BIN%" -c "import fastapi, uvicorn, pydantic, sqlalchemy, cryptography, PIL, numpy, onnx, onnxruntime" >nul 2>&1

if errorlevel 1 (
    echo       Missing backend packages detected.
    echo       Installing backend requirements stack...

    "%PIP_BIN%" install --upgrade pip -q
    if exist "%BLOCK_DIR%\backend\requirements.txt" (
        "%PIP_BIN%" install -r "%BLOCK_DIR%\backend\requirements.txt"
    ) else (
        "%PIP_BIN%" install fastapi uvicorn pydantic pydantic-settings sqlalchemy cryptography pillow numpy pytest python-multipart httpx scipy scikit-learn networkx opencv-python-headless onnx onnxruntime
    )

    if errorlevel 1 (
        color 0C
        echo [ERROR] Backend dependency installation failed.
        pause
        exit /b 1
    )

    :: Check PyTorch CPU
    "%PY_BIN%" -c "import torch" >nul 2>&1
    if errorlevel 1 (
        echo       Installing CPU-optimized PyTorch...
        "%PIP_BIN%" install torch --index-url https://download.pytorch.org/whl/cpu
    )

    echo       Backend dependencies installed successfully.
) else (
    echo       All core backend dependencies verified.
)

:: ============================================================================
:: 3. Node.js & frontend dependencies verification
:: ============================================================================

if /I "%MODE%"=="demo" goto SKIP_NODE_CHECK

echo [3/6] Verifying Node.js ^& frontend dependencies...

node --version >nul 2>&1

if errorlevel 1 (
    color 0E
    echo [WARNING] Node.js was not found in PATH.
    echo           Frontend development server cannot start.
    echo           Falling back to backend-only mode.
    set "MODE=backend_only"
    goto SKIP_NODE_CHECK
)

for /f "tokens=*" %%v in ('node --version 2^>^&1') do set "NODE_VER=%%v"
echo       Node.js %NODE_VER%

if not exist "%FRONTEND_DIR%\node_modules\vite" (
    echo       Frontend node_modules not found.
    echo       Running npm install...

    pushd "%FRONTEND_DIR%"
    call npm install
    set "NPM_RESULT=!errorlevel!"
    popd

    if not "!NPM_RESULT!"=="0" (
        color 0E
        echo [WARNING] npm install failed.
        echo           Falling back to backend-only mode.
        set "MODE=backend_only"
        goto SKIP_NODE_CHECK
    )

    echo       Frontend dependencies installed.
) else (
    echo       Frontend modules verified.
)

:SKIP_NODE_CHECK

:: ============================================================================
:: 4. Verify storage directories
:: ============================================================================

echo [4/6] Verifying air-gapped storage directories...

for %%D in (
    "%BLOCK_DIR%\data\manifests"
    "%BLOCK_DIR%\data\models\manifests"
    "%BLOCK_DIR%\data\models\baselines"
    "%BLOCK_DIR%\data\models\uploads"
    "%BLOCK_DIR%\data\inference_dna"
    "%BLOCK_DIR%\data\fingerprints"
    "%BLOCK_DIR%\data\drift\baselines"
    "%BLOCK_DIR%\data\drift\reports"
    "%BLOCK_DIR%\data\fusion\assessments"
    "%BLOCK_DIR%\data\fusion\evidence"
    "%BLOCK_DIR%\data\graph"
    "%BLOCK_DIR%\data\ledger"
    "%BLOCK_DIR%\data\reports\assurance"
    "%BLOCK_DIR%\data\reports"
    "%BLOCK_DIR%\data\audit"
    "%BLOCK_DIR%\data\uploads"
    "%BLOCK_DIR%\data\quarantine\attacks"
    "%BLOCK_DIR%\data\quarantine\models"
    "%BLOCK_DIR%\data\redteam\sandbox"
    "%BLOCK_DIR%\data\redteam\results"
    "%BLOCK_DIR%\data\keys"
) do (
    if not exist "%%~D" mkdir "%%~D" >nul 2>&1
)

echo       Storage tree verified.

:: ============================================================================
:: 5. Core subsystem validation (smoke tests)
:: ============================================================================

echo [5/6] Executing core subsystem validation...

pushd "%BLOCK_DIR%"
set "PYTHONPATH=backend"
"%PY_BIN%" -m pytest backend\tests\test_config.py backend\tests\test_crypto.py backend\tests\test_health.py -q --tb=short

set "SMOKE_RESULT=!errorlevel!"
popd

if not "%SMOKE_RESULT%"=="0" (
    color 0E
    echo.
    echo [WARNING] Core subsystem test reported warnings.
    echo           Review output above if required.
    echo.
    choice /C YN /M "Continue launching TRUST-CV"
    if errorlevel 2 exit /b 1
) else (
    echo       Cryptographic ^& health foundations verified.
)

:: ============================================================================
:: Special modes: build ^& test
:: ============================================================================

if /I "%MODE%"=="test" goto RUN_TESTS
if /I "%MODE%"=="build" goto RUN_BUILD

:: ============================================================================
:: 6. Service Execution
:: ============================================================================

echo [6/6] Launching TRUST-CV Defense Services (%MODE% mode)...
echo.

set "PYTHONPATH=%BACKEND_DIR%"

if /I "%MODE%"=="demo" goto LAUNCH_DEMO
if /I "%MODE%"=="backend_only" goto LAUNCH_BACKEND_ONLY

:: ============================================================================
:: DEVELOPMENT MODE
:: ============================================================================

echo [*] Development mode active.
echo.

:: Check if backend port 8000 is occupied
curl.exe -fs http://127.0.0.1:8000/api/v1/system/health >nul 2>&1
if not errorlevel 1 (
    echo [OK] Backend already running on port 8000.
) else (
    echo [*] Starting FastAPI Backend on port 8000...
    start "TRUST-CV Backend - port 8000" cmd /k "cd /d ""%BLOCK_DIR%"" && set ""PYTHONPATH=%BACKEND_DIR%"" && ""%PY_BIN%"" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload"
)

:: Wait for backend readiness (fast curl with fallback)
echo  [*] Waiting for backend online...
set /a ATTEMPTS=0
:WAIT_BACKEND_FAST
set /a ATTEMPTS+=1
curl.exe -fs http://127.0.0.1:8000/api/v1/system/health >nul 2>&1
if errorlevel 1 (
    if !ATTEMPTS! LEQ 30 (
        timeout /t 1 /nobreak >nul
        echo | set /p=.
        goto WAIT_BACKEND_FAST
    )
    echo  [!] Backend taking longer than expected. Continuing...
) else (
    echo  [ONLINE]
)

:: Check if frontend port 5173 is occupied
curl.exe -fs http://127.0.0.1:5173 >nul 2>&1
if not errorlevel 1 (
    echo [OK] Frontend already running on port 5173.
) else (
    echo [*] Starting Vite Frontend on port 5173...
    start "TRUST-CV Frontend - port 5173" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm run dev"
)

:: Wait for frontend readiness
echo  [*] Waiting for frontend online...
set /a ATTEMPTS=0
:WAIT_FRONTEND_FAST
set /a ATTEMPTS+=1
curl.exe -fs http://127.0.0.1:5173 >nul 2>&1
if errorlevel 1 (
    if !ATTEMPTS! LEQ 20 (
        timeout /t 1 /nobreak >nul
        echo | set /p=.
        goto WAIT_FRONTEND_FAST
    )
    echo  [!] Frontend taking longer than expected. Continuing...
) else (
    echo  [ONLINE]
)

goto SYSTEM_READY

:: ============================================================================
:: DEMO MODE
:: ============================================================================

:LAUNCH_DEMO

echo [*] Demo production mode active.
echo.

if not exist "%FRONTEND_DIR%\dist\index.html" (
    echo [!] Production frontend build not found.
    echo [*] Building frontend bundle...

    pushd "%FRONTEND_DIR%"
    call npm run build
    set "BUILD_RESULT=!errorlevel!"
    popd

    if not "!BUILD_RESULT!"=="0" (
        color 0E
        echo [WARNING] Frontend build failed. Backend API still available at http://localhost:8000/docs
    )
)

if not exist "%BACKEND_DIR%\app\static" mkdir "%BACKEND_DIR%\app\static"
if not exist "%BACKEND_DIR%\app\templates" mkdir "%BACKEND_DIR%\app\templates"

if exist "%FRONTEND_DIR%\dist\index.html" (
    echo [*] Synchronizing frontend bundle to backend static/templates...
    xcopy "%FRONTEND_DIR%\dist\*" "%BACKEND_DIR%\app\static\" /E /I /Y /Q >nul 2>&1
    copy /Y "%FRONTEND_DIR%\dist\index.html" "%BACKEND_DIR%\app\templates\index.html" >nul 2>&1
)

echo.
echo ================================================================================
echo  TRUST-CV FULL STACK DEFENSE SUITE ONLINE ^(DEMO MODE^)
echo    Tactical Analyst UI : http://localhost:8000
echo    Backend API Docs    : http://localhost:8000/docs
echo    Backend Health      : http://localhost:8000/api/v1/system/health
echo    Ledger Verify       : http://localhost:8000/api/v1/ledger/verify
echo    Evidence Graph      : http://localhost:8000/api/v1/graph/export
echo ================================================================================
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"

pushd "%BLOCK_DIR%"
set "PYTHONPATH=%BACKEND_DIR%"
"%PY_BIN%" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
set "BACKEND_RESULT=!errorlevel!"
popd

exit /b %BACKEND_RESULT%

:: ============================================================================
:: BACKEND ONLY MODE
:: ============================================================================

:LAUNCH_BACKEND_ONLY

echo [*] Backend-only mode active.
echo.
echo ================================================================================
echo  Backend API: http://localhost:8000/docs
echo ================================================================================
echo.

pushd "%BLOCK_DIR%"
set "PYTHONPATH=%BACKEND_DIR%"
"%PY_BIN%" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
set "BACKEND_RESULT=!errorlevel!"
popd

exit /b %BACKEND_RESULT%

:: ============================================================================
:: SYSTEM READY BANNER
:: ============================================================================

:SYSTEM_READY

echo.
echo ================================================================================
echo  TRUST-CV FULL STACK DEFENSE SUITE ONLINE ^(DEV MODE^)
echo    Frontend Web UI     : http://localhost:5173
echo    Backend API Docs    : http://localhost:8000/docs
echo    Built-in SOC UI     : http://localhost:8000
echo    API Health Check    : http://localhost:8000/api/v1/system/health
echo    Ledger Verification : http://localhost:8000/api/v1/ledger/verify
echo    Evidence Graph      : http://localhost:8000/api/v1/graph/export
echo ================================================================================
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"

echo TRUST-CV is running in background terminal windows.
echo Close the respective cmd windows when you wish to stop the services.
echo.

goto END

:: ============================================================================
:: TEST MODE
:: ============================================================================

:RUN_TESTS

echo.
echo ================================================================================
echo  TRUST-CV FULL TEST MODE
echo ================================================================================
echo.

echo [TEST] Executing full backend test suite...
echo.

pushd "%BLOCK_DIR%"
set "PYTHONPATH=%BACKEND_DIR%"
"%PY_BIN%" -m pytest backend\tests\ -v --tb=short
set "BACKEND_RESULT=!errorlevel!"
popd

echo.
echo [TEST] Backend exit code: %BACKEND_RESULT%
echo.

echo [TEST] Executing frontend test suite...
echo.

pushd "%FRONTEND_DIR%"
call npm run test
set "FRONTEND_RESULT=!errorlevel!"
popd

echo.
echo ================================================================================
echo  TEST EXECUTION SUMMARY
echo.
if "%BACKEND_RESULT%"=="0" (
    echo  Backend  : PASS
) else (
    echo  Backend  : FAIL ^(exit %BACKEND_RESULT%^)
)

if "%FRONTEND_RESULT%"=="0" (
    echo  Frontend : PASS
) else (
    echo  Frontend : FAIL ^(exit %FRONTEND_RESULT%^)
)
echo ================================================================================
echo.

pause
if not "%BACKEND_RESULT%"=="0" exit /b %BACKEND_RESULT%
if not "%FRONTEND_RESULT%"=="0" exit /b %FRONTEND_RESULT%
exit /b 0

:: ============================================================================
:: BUILD MODE
:: ============================================================================

:RUN_BUILD

echo.
echo ================================================================================
echo  TRUST-CV FRONTEND PRODUCTION BUILD
echo ================================================================================
echo.

pushd "%FRONTEND_DIR%"
call npm run build
set "BUILD_RESULT=!errorlevel!"
popd

if not "%BUILD_RESULT%"=="0" (
    color 0C
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\app\static" mkdir "%BACKEND_DIR%\app\static"
if not exist "%BACKEND_DIR%\app\templates" mkdir "%BACKEND_DIR%\app\templates"

echo [BUILD] Copying production bundle to backend static/templates...
xcopy "%FRONTEND_DIR%\dist\*" "%BACKEND_DIR%\app\static\" /E /I /Y /Q >nul 2>&1
copy /Y "%FRONTEND_DIR%\dist\index.html" "%BACKEND_DIR%\app\templates\index.html" >nul 2>&1

echo.
echo ================================================================================
echo  BUILD COMPLETE
echo    Frontend bundle : frontend\dist\
echo    Backend static  : Block-Sentinal\backend\app\static\
echo    Template        : Block-Sentinal\backend\app\templates\index.html
echo.
echo    To launch demo production mode:
echo       run_trust_cv.bat demo
echo ================================================================================
echo.

pause
exit /b 0

:: ============================================================================
:: END
:: ============================================================================

:END
endlocal
exit /b 0