cmake_minimum_required(VERSION 3.16)
project(orders_dashboard_launcher LANGUAGES CXX)

add_executable(orders
    native/launcher.cpp
    native/launcher.hpp
    native/main.cpp
    native/main.hpp
)
target_compile_features(orders PRIVATE cxx_std_17)
set_target_properties(orders PROPERTIES CXX_EXTENSIONS OFF)
if(MSVC)
    target_compile_options(orders PRIVATE /W4 /utf-8)
else()
    target_compile_options(orders PRIVATE -Wall -Wextra -Wpedantic)
endif()
