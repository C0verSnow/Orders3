cmake_minimum_required(VERSION 3.24)
project(orders_dashboard VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

include(CTest)
include(GNUInstallDirs)
find_package(Qt6 6.4 REQUIRED COMPONENTS Core Network Sql Concurrent HttpServer)

add_library(orders_core STATIC
    src/core/config.cpp
    src/core/cron.cpp
    src/core/parser.cpp
    src/infrastructure/http_client.cpp
    src/infrastructure/storage.cpp
    src/services/fetcher.cpp
    src/services/dashboard.cpp
    src/services/scheduler.cpp
)
target_include_directories(orders_core PUBLIC src)
target_link_libraries(orders_core PUBLIC Qt6::Core Qt6::Network Qt6::Sql Qt6::Concurrent)

qt_add_executable(orders src/app/main.cpp src/app/server.cpp resources.qrc)
target_link_libraries(orders PRIVATE orders_core Qt6::HttpServer)
if(WIN32)
    find_package(Qt6 REQUIRED COMPONENTS Gui Widgets WebEngineWidgets)
    target_sources(orders PRIVATE src/ui/desktop.cpp)
    target_compile_definitions(orders PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
    target_link_libraries(orders PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)
    set_target_properties(orders PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

foreach(target orders_core orders)
    if(MSVC)
        target_compile_options(${target} PRIVATE /W4 /utf-8 /permissive-)
        set_property(TARGET ${target} PROPERTY MSVC_RUNTIME_LIBRARY
            "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    else()
        target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
    endif()
endforeach()

if(BUILD_TESTING)
    find_package(Qt6 REQUIRED COMPONENTS Test)
    qt_add_executable(orders_tests tests/cpp/core_tests.cpp)
    target_link_libraries(orders_tests PRIVATE orders_core Qt6::Test)
    add_test(NAME orders_core COMMAND orders_tests -v2)
endif()

install(TARGETS orders RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES .env.example config.example DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES README.md docs/architecture.md docs/third-party.md
    DESTINATION ${CMAKE_INSTALL_DOCDIR})
