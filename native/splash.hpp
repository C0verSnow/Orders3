#pragma once

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <string>
#include <thread>

namespace orders {

// Show feedback before Python/WebView2 initialize; the child signals readiness.
class StartupSplash {
    HANDLE ready_ = nullptr;
    HANDLE closed_ = nullptr;
    std::atomic<bool> stopped_{false};
    std::thread thread_;
    std::string previous_event_;
    std::string previous_closed_event_;

    static LRESULT CALLBACK procedure(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
        if (message == WM_PAINT) {
            PAINTSTRUCT paint;
            HDC target = BeginPaint(window, &paint);
            RECT bounds{};
            GetClientRect(window, &bounds);
            HDC buffer = CreateCompatibleDC(target);
            HBITMAP bitmap = CreateCompatibleBitmap(target, bounds.right, bounds.bottom);
            HGDIOBJ old_bitmap = SelectObject(buffer, bitmap);
            HBRUSH background = CreateSolidBrush(RGB(246, 248, 245));
            FillRect(buffer, &bounds, background);
            DeleteObject(background);
            SetViewportOrgEx(buffer, (bounds.right - 420) / 2, (bounds.bottom - 300) / 2, nullptr);
            HBRUSH dark = CreateSolidBrush(RGB(24, 46, 38));
            HGDIOBJ old_brush = SelectObject(buffer, dark);
            HGDIOBJ old_pen = SelectObject(buffer, GetStockObject(NULL_PEN));
            RoundRect(buffer, 170, 62, 250, 142, 48, 48);
            HBRUSH green = CreateSolidBrush(RGB(197, 244, 125));
            SelectObject(buffer, green);
            // Match logo.svg exactly so the web logo continues the same silhouette.
            for (int index = 0; index < 3; ++index) {
                const int x = 192 + index * 18;
                const int top = index == 1 ? 86 : index == 0 ? 94 : 96;
                const int bottom = index == 1 ? 118 : index == 0 ? 112 : 110;
                RoundRect(buffer, x - 3, top - 3, x + 3, bottom + 3, 6, 6);
                const int y = index == 1 ? 96 : 104;
                Ellipse(buffer, x - 6, y - 6, x + 6, y + 6);
            }
            SelectObject(buffer, old_brush);
            SelectObject(buffer, old_pen);
            DeleteObject(green);
            DeleteObject(dark);
            SetBkMode(buffer, TRANSPARENT);
            SetTextColor(buffer, RGB(34, 53, 46));
            HFONT title = CreateFontW(-32, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
                                     DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
            HGDIOBJ old_font = SelectObject(buffer, title);
            RECT title_rect{0, 161, 420, 207};
            DrawTextW(buffer, L"orders.", -1, &title_rect, DT_CENTER | DT_SINGLELINE);
            HFONT caption = CreateFontW(-14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                                       DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
            SelectObject(buffer, caption);
            SetTextColor(buffer, RGB(130, 146, 126));
            RECT caption_rect{0, 214, 420, 244};
            DrawTextW(buffer, L"你的数据工作台", -1, &caption_rect, DT_CENTER | DT_SINGLELINE);
            SelectObject(buffer, old_font);
            DeleteObject(title);
            DeleteObject(caption);
            SetViewportOrgEx(buffer, 0, 0, nullptr);
            BitBlt(target, 0, 0, bounds.right, bounds.bottom, buffer, 0, 0, SRCCOPY);
            SelectObject(buffer, old_bitmap);
            DeleteObject(bitmap);
            DeleteDC(buffer);
            EndPaint(window, &paint);
            return 0;
        }
        if (message == WM_ERASEBKGND) return 1;
        return DefWindowProcW(window, message, wparam, lparam);
    }

    void run() {
        const HINSTANCE instance = GetModuleHandleW(nullptr);
        WNDCLASSW type{};
        type.lpfnWndProc = procedure;
        type.hInstance = instance;
        type.lpszClassName = L"OrdersStartupSplash";
        type.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
        RegisterClassW(&type);
        const HWND window = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOOLWINDOW,
            type.lpszClassName, L"Orders starting", WS_POPUP,
            (GetSystemMetrics(SM_CXSCREEN) - 420) / 2,
            (GetSystemMetrics(SM_CYSCREEN) - 300) / 2, 420, 300,
            nullptr, nullptr, instance, nullptr);
        if (!window) return;
        SetWindowRgn(window, CreateRoundRectRgn(0, 0, 421, 301, 28, 28), TRUE);
        SetLayeredWindowAttributes(window, 0, 0, LWA_ALPHA);
        ShowWindow(window, SW_SHOWNOACTIVATE);
        const ULONGLONG started = GetTickCount64();
        ULONGLONG exiting = 0;
        RECT origin{};
        GetWindowRect(window, &origin);
        RECT destination = origin;
        while (true) {
            MSG message;
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            const ULONGLONG now = GetTickCount64();
            if (!exiting && (stopped_ || WaitForSingleObject(ready_, 0) == WAIT_OBJECT_0)) {
                exiting = now;
                HWND home = FindWindowW(nullptr, L"Orders · 本地订单看板");
                if (home) {
                    GetClientRect(home, &destination);
                    MapWindowPoints(home, nullptr, reinterpret_cast<POINT*>(&destination), 2);
                    SetWindowPos(window, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                }
            }
            const double entry = std::clamp(static_cast<double>(now - started) / 220, 0.0, 1.0);
            double alpha = entry * entry * (3 - 2 * entry);
            if (exiting) {
                const double t = std::clamp(static_cast<double>(now - exiting) / 400, 0.0, 1.0);
                if (t >= 1) break;
                const double ease = 1 - std::pow(1 - t, 3);
                auto mix = [ease](LONG from, LONG to) { return static_cast<int>(from + (to - from) * ease); };
                const int width = mix(origin.right - origin.left, destination.right - destination.left);
                const int height = mix(origin.bottom - origin.top, destination.bottom - destination.top);
                SetWindowPos(window, nullptr, mix(origin.left, destination.left), mix(origin.top, destination.top),
                             width, height, SWP_NOZORDER | SWP_NOACTIVATE);
                SetWindowRgn(window, CreateRoundRectRgn(0, 0, width + 1, height + 1,
                              static_cast<int>(28 * (1 - ease)) + 1, static_cast<int>(28 * (1 - ease)) + 1), TRUE);
                const double fade = std::clamp((t - .45) / .55, 0.0, 1.0);
                alpha *= 1 - fade * fade * (3 - 2 * fade);
            }
            SetLayeredWindowAttributes(window, 0, static_cast<BYTE>(255 * alpha), LWA_ALPHA);
            InvalidateRect(window, nullptr, FALSE);
            UpdateWindow(window);
            Sleep(16);
        }
        DestroyWindow(window);
        UnregisterClassW(type.lpszClassName, instance);
    }

public:
    explicit StartupSplash(bool enabled) {
        if (!enabled) return;
        const std::string name = "Local\\OrdersReady-" + std::to_string(GetCurrentProcessId());
        ready_ = CreateEventA(nullptr, TRUE, FALSE, name.c_str());
        if (!ready_) return;
        const char* previous = std::getenv("ORDERS_READY_EVENT");
        if (previous) previous_event_ = previous;
        _putenv_s("ORDERS_READY_EVENT", name.c_str());
        const std::string closed_name = "Local\\OrdersClosed-" + std::to_string(GetCurrentProcessId());
        closed_ = CreateEventA(nullptr, TRUE, FALSE, closed_name.c_str());
        const char* previous_closed = std::getenv("ORDERS_CLOSED_EVENT");
        if (previous_closed) previous_closed_event_ = previous_closed;
        if (closed_) _putenv_s("ORDERS_CLOSED_EVENT", closed_name.c_str());
        thread_ = std::thread([this] { run(); });
    }

    void wait_for_process(HANDLE process) {
        if (closed_) {
            HANDLE events[] = {process, closed_};
            WaitForMultipleObjects(2, events, FALSE, INFINITE);
        } else {
            WaitForSingleObject(process, INFINITE);
        }
    }

    ~StartupSplash() {
        stopped_ = true;
        if (thread_.joinable()) thread_.join();
        if (ready_) {
            CloseHandle(ready_);
            _putenv_s("ORDERS_READY_EVENT", previous_event_.c_str());
        }
        if (closed_) {
            CloseHandle(closed_);
            _putenv_s("ORDERS_CLOSED_EVENT", previous_closed_event_.c_str());
        }
    }
};

}  // namespace orders
#endif
