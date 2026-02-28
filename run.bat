@echo off
SETLOCAL EnableDelayedExpansion

TITLE Nanobot Starter

echo ==========================================
echo           Starting Nanobot...
echo ==========================================

:: Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if .env exists, if not copy from .env.example
if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] .env file not found. Creating from .env.example...
        copy .env.example .env
        echo [IMPORTANT] Please edit your .env file with your API keys.
    ) else (
        echo [WARNING] Neither .env nor .env.example found. The bot might fail to start.
    )
)

:: Check if node_modules exists
if not exist "node_modules\" (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: Start the bot
echo [INFO] Starting the bot...
echo.
call npm start

:: Keep window open if it crashes
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] The bot has stopped unexpectedly (Error: %errorlevel%).
    pause
)

ENDLOCAL
