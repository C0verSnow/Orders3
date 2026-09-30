// Offline checks: exercise the production parser without downloading signals.
#define main fetchorders_main
#include "../src/fetchorders.cpp"
#undef main

void require(bool condition) {
    if (!condition) throw std::runtime_error("Check failed");
}

int main() {
    const std::string short_order =
        "Order Alert\nSymbol: SOL_USDT\nPrice: 125.45 USDT\n"
        "Side: Open Short\nSize: -1 Contracts\nValue: -125.45 U\n";
    const std::string stamp = "Orders Times: 1790390566354\n";
    auto replace = [](std::string input, const std::string& from, const std::string& to) {
        input.replace(input.find(from), from.size(), to);
        return input;
    };
    int rejected = 0;
    auto reject = [&](const std::string& input, const std::string& reason = "") {
        try { parse_orders(input); }
        catch (const std::exception& error) {
            require(reason.empty() || error.what() == reason);
            ++rejected;
            return;
        }
        throw std::runtime_error("Accepted invalid signal");
    };
    const auto parsed = parse_orders(short_order + stamp);
    require(parsed["last timestamp"] == 1790390566354LL);
    require(parsed["raw orders"][0]["Contract"] == "SOL_USDT");
    require(parsed["raw orders"][0]["Size"] == -1);
    require(parsed["raw orders"][0]["Price"] == 125.45);
    auto long_order = replace(replace(short_order, "Open Short", "Open Long"),
                              "-1 Contracts", "1 Contracts");
    require(parse_orders(short_order + long_order + stamp)["raw orders"].size() == 2);
    require(parse_orders(short_order + replace(short_order, "SOL_USDT", "BTC_USDT") + stamp)
                ["raw orders"].size() == 2);
    reject(short_order + short_order + stamp, "DUPLICATE_TARGET");
    reject(long_order + long_order + stamp, "DUPLICATE_TARGET");
    reject(replace(short_order, "-1 Contracts", "1 Contracts") + stamp);
    reject(replace(long_order, "1 Contracts", "-1 Contracts") + stamp);
    for (const auto& field : {"Symbol: SOL_USDT\n", "Price: 125.45 USDT\n",
                              "Side: Open Short\n", "Size: -1 Contracts\n", "Value: -125.45 U\n"}) {
        reject(replace(short_order, field, "") + stamp);
        reject(replace(short_order, field, std::string(field) + field) + stamp);
    }
    for (const auto& side : {"Close Short", "Close Long", "unknown"})
        reject(replace(short_order, "Open Short", side) + stamp);
    for (const auto& size : {"0", "1.5", "-9223372036854775809", "nan"})
        reject(replace(short_order, "-1 Contracts", std::string(size) + " Contracts") + stamp);
    for (const auto& price : {"0", "-1", "nan", "inf", "1e2", "1 garbage"})
        reject(replace(short_order, "125.45 USDT", std::string(price) + " USDT") + stamp);
    reject(replace(short_order, "SOL_USDT", "bad/symbol") + stamp);
    reject(replace(short_order, "-125.45 U", "nan U") + stamp);
    reject(short_order);
    reject(short_order + stamp + stamp);
    reject(short_order + stamp + long_order);
    for (const auto& time : {"0", "-1", "1.2", "9223372036854775808", "123 junk"})
        reject(short_order + "Orders Times: " + time + "\n");
    reject("<html>error</html>");
    std::cout << "Signal parser checks passed (valid single/mixed targets; "
              << rejected << " invalid batches rejected)\n";
}
