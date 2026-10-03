#pragma once

namespace orders {

// Start the configured dashboard or forward arguments to the Python runtime.
int frequency(int argc = 0, char* argv[] = nullptr);

// Fetch trailing orders once through the shared Python runtime.
int list();

}  // namespace orders
