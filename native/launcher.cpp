#include <cerrno>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <process.h>
#else
#include <sys/wait.h>
#include <unistd.h>
#endif

#ifdef _WIN32
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
#endif

// Python reads root/config, runs Cron refreshes and exposes configuration to the UI.
// Calling frequency() without arguments starts the configured dashboard.
int frequency(int argc = 0, char* argv[] = nullptr) {
    try {
        namespace fs = std::filesystem;
        fs::path script = fs::absolute(fs::path(__FILE__)).parent_path().parent_path() / "scripts" / "run.py";
        if (!fs::exists(script) && argc > 0 && argv != nullptr) {
            script = fs::absolute(fs::path(argv[0])).parent_path().parent_path() / "scripts" / "run.py";
        }
        if (!fs::exists(script)) {
            std::cerr << "Cannot find scripts/run.py; build and run from the repository layout.\n";
            return 1;
        }

        const char* configured = std::getenv("PYTHON");
        const std::string interpreter = configured && *configured ? configured : "python";
        const std::string script_name = script.string();
        std::vector<std::string> values = {interpreter, script_name};
        for (int index = 1; index < argc; ++index) values.emplace_back(argv[index]);
#ifdef _WIN32
        for (std::string& value : values) value = quote_argument(value);
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

int main(int argc, char* argv[]) {
    return frequency(argc, argv);
}
