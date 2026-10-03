#include "launcher.hpp"
#ifdef _WIN32
#include <windows.h>
#include <cstdlib>

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    return orders::launch(__argc, __argv);
}
#endif

int main(int argc, char* argv[]) {
    return orders::launch(argc, argv);
}
