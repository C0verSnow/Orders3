#pragma once

#include "close_snapshot.hpp"

namespace orders3 {

struct CloseRequestError : std::invalid_argument {
    std::string field;
    explicit CloseRequestError(const std::string& name)
        : std::invalid_argument("INVALID_CLOSE_REQUEST: " + name), field(name) {}
};

// Caller must first match the Position identity/mode and calculate/round the
// activation price from all covered sources. This only builds an HTTP descriptor;
// it neither sends an order nor persists a publish intent.
inline nlohmann::json make_close_request(const std::string& contract,
                                         const std::string& position_side,
                                         const nlohmann::json& snapshot,
                                         const nlohmann::json& activation_price) {
    if (contract.empty()) throw CloseRequestError("contract");
    const auto position = validate_close_snapshot(snapshot, position_side);
    if (!activation_price.is_string()) throw CloseRequestError("activation_price");
    const auto& price = activation_price.get_ref<const std::string&>();
    int price_sign;
    try {
        price_sign = close_snapshot_detail::sign(price, "activation_price");
    } catch (const CloseSnapshotError&) {
        throw CloseRequestError("activation_price");
    }
    if (price_sign <= 0) throw CloseRequestError("activation_price");

    const auto amount = position_side == "LONG"
        ? "-" + position.size : position.size.substr(1);
    return {{"method", "POST"},
            {"path", "/futures/usdt/autoorder/v1/trail/create"},
            {"query", ""},
            {"body", {{"contract", contract}, {"amount", amount},
                      {"reduce_only", true}, {"activation_price", price},
                      {"is_gte", position_side == "LONG"}, {"price_type", 3},
                      {"price_offset", "1%"}, {"text", "apiv4"},
                      {"pos_margin_mode", "cross"}, {"position_mode", "dual_plus"}}}};
}

} // namespace orders3
