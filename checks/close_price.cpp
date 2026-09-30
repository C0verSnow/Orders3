#include "../src/close_price.hpp"
#include "../src/close_request.hpp"
#include <iostream>
#include <vector>

using nlohmann::json;
int main() {
    int passed = 0;
    auto require = [&](bool ok) {
        if (!ok) throw std::runtime_error("Close price mismatch");
        ++passed;
    };
    const json base{{"entry_price", "100"}, {"value", "1000"},
                    {"initial_margin", "10"}, {"size", "10"}};
    const auto sources = [](const json& price) { return json::array({{{"trigger_price", price}}}); };
    auto rejected = [&](const json& p, const json& s, const std::string& field) {
        bool caught = false;
        try { orders3::calculate_close_price(p, "LONG", s); }
        catch (const orders3::CloseSnapshotError& e) { caught = e.field == field; }
        require(caught);
    };
    for (bool short_side : {false, true}) {
        auto p = base;
        p["size"] = short_side ? "-10" : "10";
        const auto side = short_side ? "SHORT" : "LONG";
        const auto price = orders3::calculate_close_price(p, side, sources("100.00"));
        require(price == (short_side ? "95.93" : "104.13"));
        const auto body = orders3::make_close_request("BTC_USDT", side, p, price)["body"];
        require(body["activation_price"] == price);
        require(body["amount"] == (short_side ? "10" : "-10"));
    }
    json all = json::array({{{"trigger_price", "1.0"}}, {{"trigger_price", "2.0000"}}, {{"trigger_price", "3"}}});
    const auto before = all.dump();
    require(orders3::calculate_close_price(base, "LONG", all) == "104.1310");
    std::reverse(all.begin(), all.end());
    require(orders3::calculate_close_price(base, "LONG", all) == "104.1310");
    std::reverse(all.begin(), all.end());
    require(all.dump() == before);
    require(orders3::calculate_close_price(base, "LONG", sources("1")) == "104");

    // Independent bounded integer oracle, including half ties and carry.
    auto p = base;
    p["initial_margin"] = "0";
    for (int cents = 1; cents <= 1000; ++cents) {
        p["entry_price"] = std::to_string(cents / 100) + "." +
            (cents % 100 < 10 ? "0" : "") + std::to_string(cents % 100);
        const int rounded = (cents * 101 + 50) / 100;
        const auto expected = std::to_string(rounded / 100) + "." +
            (rounded % 100 < 10 ? "0" : "") + std::to_string(rounded % 100);
        require(orders3::calculate_close_price(p, "LONG", sources("1.00")) == expected);
    }
    p["entry_price"] = "9007199254740993";
    require(orders3::calculate_close_price(p, "LONG", sources("1.00")) == "9097271247288402.93");
    p["entry_price"] = "0." + std::string(399, '0') + "1";
    require(orders3::calculate_close_price(p, "LONG", sources("1." + std::string(402, '0'))) ==
            "0." + std::string(399, '0') + "101");
    rejected(p, sources("1.00"), "activation_price");
    p = base;
    p["value"] = "-31";
    rejected(p, sources("1.00"), "target_raw");
    for (const auto& bad : std::vector<json>{nullptr, 1, "", "0", "-0.00", "-1", "1e2", "1.", ".1", " 1", "+1", "NaN"})
        rejected(base, sources(bad), "trigger_price");
    for (const auto& bad : std::vector<json>{nullptr, json::object(), json::array()})
        rejected(base, bad, "covered_sources");
    rejected(base, json::array({json::object()}), "trigger_price");
    rejected(base, json::array({"1.00"}), "trigger_price");
    all.push_back({{"trigger_price", nullptr}, {"signal_price", "100.00"}});
    const auto invalid_before = all.dump();
    rejected(base, all, "trigger_price");
    require(all.dump() == invalid_before);
    require(base["entry_price"] == "100");
    std::cout << "Close price checks passed: " << passed << '\n';
}
