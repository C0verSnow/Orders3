#include "main.hpp"
#include "launcher.hpp"

#include <cerrno>
#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>
#include "splash.hpp"

#ifdef _WIN32
#include <process.h>
#else
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace orders {

#ifdef _WIN32
namespace {
// _spawnvp joins arguments into a command line; preserve spaces and backslashes.
static std::string quote_argument(const std::string& value) {
    std::string quoted = "\"";
    std::size_t backslashes = 0;
    for (char character : value) {
        if (character == '\\') {
            ++backslashes;
            continue;
        }
        quoted.append(backslashes * (character == '"' ? 2 : 1), '\\');
        backslashes = 0;
        if (character == '"') quoted += '\\';
        quoted += character;
    }
    quoted.append(backslashes * 2, '\\');
    quoted += '"';
    return quoted;
}
}  // namespace
#endif


// Start a Python entry script through the shared process launcher.
static int run_python(const char* script_file, int argc = 0, char* argv[] = nullptr) {
    try {
        namespace fs = std::filesystem;
        fs::path script = fs::absolute(fs::path(__FILE__)).parent_path().parent_path() / "scripts" / script_file;
        if (!fs::exists(script) && argc > 0 && argv != nullptr) {
            script = fs::absolute(fs::path(argv[0])).parent_path().parent_path() / "scripts" / script_file;
        }
        if (!fs::exists(script)) {
            std::cerr << "Cannot find scripts/" << script_file << "; build and run from the repository layout.\n";
            return 1;
        }

        const char* configured = std::getenv("PYTHON");
        const std::string interpreter = configured && *configured ? configured : "python";
        const std::string script_name = script.string();
        std::vector<std::string> values = {interpreter, script_name};
        for (int index = 1; index < argc; ++index) values.emplace_back(argv[index]);
#ifdef _WIN32
        if (std::string(script_file) == "run.py") {
            bool desktop = true;
            for (int index = 1; index < argc; ++index) {
                const std::string option = argv[index];
                if (option == "--browser" || option == "--no-browser" ||
                    option == "--fetch-only" || option == "--list" ||
                    option == "--desktop" || option == "--help" || option == "-h") desktop = false;
            }
            if (desktop) values.emplace_back("--desktop");
        }
        const bool desktop_mode = std::find(values.begin(), values.end(), "--desktop") != values.end();
        if (!desktop_mode) {
            if (!AttachConsole(ATTACH_PARENT_PROCESS)) AllocConsole();
            FILE* stream = nullptr;
            freopen_s(&stream, "CONOUT$", "w", stdout);
            freopen_s(&stream, "CONOUT$", "w", stderr);
        }
        StartupSplash splash(desktop_mode);
        for (std::string& value : values) value = quote_argument(value);
        if (desktop_mode) {
            // The job owns the entire Python/WebView process tree.
            HANDLE job = CreateJobObjectW(nullptr, nullptr);
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                                                &limits, sizeof(limits))) {
                if (job) CloseHandle(job);
                MessageBoxW(nullptr, L"无法创建独立窗口进程。", L"Orders", MB_OK | MB_ICONERROR);
                return 1;
            }
            auto start = [&](const std::string& executable, PROCESS_INFORMATION& process) {
                std::string command = quote_argument(executable);
                for (std::size_t index = 1; index < values.size(); ++index) command += " " + values[index];
                STARTUPINFOA startup{};
                startup.cb = sizeof(startup);
                return CreateProcessA(nullptr, command.data(), nullptr, nullptr, FALSE,
                                      CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr,
                                      &startup, &process);
            };
            PROCESS_INFORMATION process{};
            bool launched = start(interpreter, process);
            if (!launched && GetLastError() == ERROR_FILE_NOT_FOUND && !(configured && *configured))
                launched = start("py", process);
            if (!launched || !AssignProcessToJobObject(job, process.hProcess)) {
                if (launched) {
                    TerminateProcess(process.hProcess, 1);
                    CloseHandle(process.hThread);
                    CloseHandle(process.hProcess);
                }
                CloseHandle(job);
                MessageBoxW(nullptr, L"无法启动 Python 独立窗口，请检查 Python 和窗口依赖。",
                            L"Orders", MB_OK | MB_ICONERROR);
                return 1;
            }
            ResumeThread(process.hThread);
            CloseHandle(process.hThread);
            splash.wait_for_process(process.hProcess);
            DWORD result = 1;
            GetExitCodeProcess(process.hProcess, &result);
            if (result == STILL_ACTIVE) result = 0;
            CloseHandle(process.hProcess);
            CloseHandle(job);
            return static_cast<int>(result);
        }
#endif
        std::vector<const char*> arguments;
        for (const std::string& value : values) arguments.push_back(value.c_str());
        arguments.push_back(nullptr);
#ifdef _WIN32
        intptr_t result = _spawnvp(_P_WAIT, interpreter.c_str(), arguments.data());
        if (result == -1 && errno == ENOENT && !(configured && *configured)) {
            arguments[0] = "py";
            result = _spawnvp(_P_WAIT, "py", arguments.data());
        }
        if (result == -1) {
            std::cerr << "Cannot start Python (errno " << errno << ").\n";
            return 1;
        }
        return static_cast<int>(result);
#else
        const pid_t child = fork();
        if (child == -1) {
            std::cerr << "Cannot create Python process.\n";
            return 1;
        }
        if (child == 0) {
            execvp(interpreter.c_str(), const_cast<char* const*>(arguments.data()));
            if (errno == ENOENT && !(configured && *configured)) {
                arguments[0] = "python3";
                execvp("python3", const_cast<char* const*>(arguments.data()));
            }
            std::cerr << "Cannot start Python.\n";
            _exit(1);
        }
        int status = 0;
        while (waitpid(child, &status, 0) == -1) {
            if (errno != EINTR) return 1;
        }
        return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
#endif
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}

// Start the configured dashboard; optional arguments are forwarded unchanged.
int frequency(int argc, char* argv[]) {
    return run_python("run.py", argc, argv);
}

// Fetch trailing orders directly, without constructing command-line options.
int list() {
    return run_python("list.py");
}

int launch(int argc, char* argv[]) {
    if (argc == 2 && std::string(argv[1]) == "--list") return list();
    return frequency(argc, argv);
}

}  // namespace orders
