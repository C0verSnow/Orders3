#include "../src/close_request.hpp"
#include <iostream>
#include <vector>

using nlohmann::json;

int main() {
    const json base{{"entry_price", "100"}, {"value", "1000"},
                    {"initial_margin", "10"}, {"size", "10"}};
    int passed = 0;
    auto check = [&](bool valid) {
        if (!valid) throw std::runtime_error("Close request check failed");
        ++passed;
    };
    const json expected{{"method", "POST"},
        {"path", "/futures/usdt/autoorder/v1/trail/create"}, {"query", ""},
        {"body", {{"contract", "BTC_USDT"}, {"amount", "-10"},
            {"reduce_only", true}, {"activation_price", "104.13"},
            {"is_gte", true}, {"price_type", 3}, {"price_offset", "1%"},
            {"text", "apiv4"}, {"pos_margin_mode", "cross"},
            {"position_mode", "dual_plus"}}}};
    check(orders3::make_close_request("BTC_USDT", "LONG", base, "104.13") == expected);
    auto short_snapshot = base;
    short_snapshot["size"] = "-10";
    auto short_expected = expected;
    short_expected["body"]["amount"] = "10";
    short_expected["body"]["is_gte"] = false;
    short_expected["body"]["activation_price"] = "95.93";
    check(orders3::make_close_request("BTC_USDT", "SHORT", short_snapshot, "95.93") == short_expected);

    for (const auto* side : {"LONG", "SHORT"}) {
        for (const std::string size : {"9007199254740993", "00010.2300", "0.00000000000000000001"}) {
            auto snapshot = base;
            const bool is_long = std::string(side) == "LONG";
            snapshot["size"] = is_long ? size : "-" + size;
            const auto before = snapshot.dump();
            for (const auto* price : {"104.1300", "9007199254740993.123456789", "0.00000000000000000001"}) {
                const auto request = orders3::make_close_request("BTC_USDT", side, snapshot, price);
                check(request["body"]["amount"] == (is_long ? "-" + size : size));
                check(request["body"]["activation_price"] == price);
                check(request["body"]["price_offset"] == "1%");
                check(json::parse(request.dump()) == request);
                check(snapshot.dump() == before);
            }
        }
    }
    auto reject = [&](const std::string& contract, const std::string& side,
                      const json& snapshot, const json& price, const std::string& field) {
        const auto before = snapshot.dump();
        try { orders3::make_close_request(contract, side, snapshot, price); }
        catch (const orders3::CloseRequestError& e) {
            check(e.field == field && snapshot.dump() == before);
            return;
        } catch (const orders3::CloseSnapshotError& e) {
            check(e.field == field && snapshot.dump() == before);
            return;
        }
        throw std::runtime_error("Invalid close request accepted");
    };
    for (const auto& price : std::vector<json>{nullptr, true, 104.13, 100, json::object(),
            json::array(), "", "0", "-0.00", "-1", "+1", "1e2", " 1", "1 ",
            "NaN", "Infinity", ".1", "1.", "1.2.3"})
        reject("BTC_USDT", "LONG", base, price, "activation_price");
    reject("", "LONG", base, "1", "contract");
    reject("BTC_USDT", "long", base, "1", "position_side");
    reject("BTC_USDT", "SHORT", base, "1", "size");
    reject("BTC_USDT", "LONG", short_snapshot, "1", "size");
    for (const auto& size : std::vector<json>{"0", "-0.00", "1e3", nullptr, 10}) {
        auto snapshot = base;
        snapshot["size"] = size;
        reject("BTC_USDT", "LONG", snapshot, "1", "size");
    }
    for (const auto* field : {"entry_price", "value", "initial_margin", "size"}) {
        auto snapshot = base;
        snapshot.erase(field);
        reject("BTC_USDT", "LONG", snapshot, "1", field);
    }
    std::cout << "close_request: " << passed << " checks passed\n";
}
