#pragma once

#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <nlohmann/json.hpp>

namespace orders3 {

class StopRequestError : public std::runtime_error {
public:
    explicit StopRequestError(const std::string& code)
        : std::runtime_error(code) {}

    nlohmann::json as_json() const {
        return {{"code", what()}, {"field", "id"}, {"retryable", false}};
    }
};

// Adapter-supported range: positive signed 64-bit integers. This is a
// conservative local bound, not a claim about the exchange's maximum ID.
// Keep the original string in local records; convert only for the stop body.
inline nlohmann::json make_stop_request(const nlohmann::json& local_id) {
    if (!local_id.is_string()) throw StopRequestError("INVALID_ORDER_ID");
    const auto& digits = local_id.get_ref<const std::string&>();
    if (digits.empty()) throw StopRequestError("INVALID_ORDER_ID");
    for (const char digit : digits) {
        if (digit < '0' || digit > '9')
            throw StopRequestError("INVALID_ORDER_ID");
    }

    std::int64_t value = 0;
    constexpr auto maximum = std::numeric_limits<std::int64_t>::max();
    for (const char character : digits) {
        const int digit = character - '0';
        if (value > (maximum - digit) / 10)
            throw StopRequestError("ORDER_ID_OUT_OF_RANGE");
        value = value * 10 + digit;
    }
    if (value == 0) throw StopRequestError("INVALID_ORDER_ID");

    return {{"method", "POST"},
            {"path", "/futures/usdt/autoorder/v1/trail/stop"},
            {"query", ""},
            {"body", {{"id", value}}}};
}

} // namespace orders3
