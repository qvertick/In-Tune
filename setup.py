
# import argparse ( Подготовка зависимостей для запуска проекта In Tune )
import os
import subprocess
import sys
import shutil
import platform

def run_cmd(cmd, cwd=None, env=None):
    """Выполняет системную команду и проверяет код возврата."""
    print(f"\n▶ Выполнение: {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    result = subprocess.run(cmd, cwd=cwd, env=env, shell=True)
    if result.returncode != 0:
        print(f"❌ Ошибка при выполнении команды (код {result.returncode})")
        sys.exit(result.returncode)

def main():
    parser = argparse.ArgumentParser(description="Единый скрипт установки и настройки проекта In Tune")
    parser.add_argument("--language", default="ru", choices=["ru", "uk", "en"], help="Язык для Vosk модели")
    parser.add_argument("--download-separation-model", action="store_true", help="Скачать модель htdemucs для разделения аудио")
    parser.add_argument("--skip-frontend", action="store_true", help="Пропустить сборку фронтенда")
    args = parser.parse_args()

    root_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root_dir)

    print("=== 1. Настройка основного окружения и бэкенда ===")
    venv_dir = os.path.join(root_dir, ".venv")
    python_exe = os.path.join(venv_dir, "Scripts", "python.exe") if platform.system() == "Windows" else os.path.join(venv_dir, "bin", "python")

    # Создание .venv если нет
    if not os.path.exists(python_exe):
        print("Создание основного виртуального окружения (.venv)...")
        run_cmd([sys.executable, "-m", "venv", ".venv"])

    # Установка зависимостей бэкенда
    lock_file = os.path.join("backend", "requirements-lock.txt")
    if os.path.exists(lock_file):
        run_cmd([python_exe, "-m", "pip", "install", "-r", lock_file])
    
    # Установка follow-зависимостей и модели
    follow_req = os.path.join("backend", "requirements-follow.txt")
    if os.path.exists(follow_req):
        if os.path.exists(python_exe):
            run_cmd([python_exe, "-m", "pip", "install", "-r", follow_req])
        else:
            run_cmd([sys.executable, "-m", "pip", "install", "--target", "backend/.deps", "-r", follow_req])
            os.environ["PYTHONPATH"] = os.path.join(root_dir, "backend", ".deps")
        
        run_cmd([python_exe, "-m", "backend.follow_provider", "--install-model", args.language])

    print("\n=== 2. Настройка окружения разделения аудио (.venv-separation) ===")
    # Проверка ffmpeg
    if not shutil.which("ffmpeg"):
        print("⚠️ Предупреждение: FFmpeg не найден в PATH. Для разделения аудио он необходим!")
    
    separation_env = os.path.join(root_dir, ".venv-separation")
    separation_python = os.path.join(separation_env, "Scripts", "python.exe") if platform.system() == "Windows" else os.path.join(separation_env, "bin", "python")

    if not os.path.exists(separation_python):
        print("Создание изолированного окружения для разделения звука...")
        run_cmd([sys.executable, "-m", "venv", ".venv-separation"])

    # Очищаем лишние переменные окружения для чистоты сборки torch
    env_clean = os.environ.copy()
    env_clean.pop("PYTHONPATH", None)
    env_clean.pop("PYTHONHOME", None)

    sep_cpu_req = os.path.join("backend", "requirements-separation-cpu.txt")
    sep_req = os.path.join("backend", "requirements-separation.txt")
    
    if os.path.exists(sep_cpu_req):
        run_cmd([separation_python, "-I", "-m", "pip", "install", "-r", sep_cpu_req], env=env_clean)
    if os.path.exists(sep_req):
        run_cmd([separation_python, "-I", "-m", "pip", "install", "-r", sep_req], env=env_clean)
    
    run_cmd([separation_python, "-I", "scripts/separate_audio.py", "--check-runtime"], env=env_clean)

    if args.download_separation_model:
        print("Скачивание модели htdemucs...")
        run_cmd([separation_python, "-I", "scripts/separate_audio.py", "--install-model"], env=env_clean)

    print("\n=== 3. Настройка и сборка фронтенда ===")
    if not args.skip_frontend:
        frontend_dir = os.path.join(root_dir, "frontend")
        if os.path.exists(frontend_dir):
            pnpm_cmd = shutil.which("pnpm") or shutil.which("pnpm.cmd")
            if not pnpm_cmd:
                # Проверяем fallback путь, если есть
                bundled_pnpm = os.path.expanduser("~/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd")
                if os.path.exists(bundled_pnpm):
                    pnpm_cmd = bundled_pnpm
            
            if pnpm_cmd:
                run_cmd([pnpm_cmd, "install", "--frozen-lockfile"], cwd=frontend_dir)
                run_cmd([pnpm_cmd, "run", "build"], cwd=frontend_dir)
            else:
                print("❌ Ошибка: pnpm не найден. Установите Node.js и pnpm.")
                sys.exit(1)

    print("\n✨ Всё готово! Для запуска проекта используйте:")
    print(f"   {python_exe} run.py")

if __name__ == "__main__":
    main()