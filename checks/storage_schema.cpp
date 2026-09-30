#include "../src/storage_schema.hpp"
#include <iostream>

using nlohmann::json;

void require(bool value) {
    if (!value) throw std::runtime_error("Storage schema check failed");
}

int main() {
    const auto initial = orders3::make_empty_store();
    require(initial.size() == 1 && initial[0].size() == 13);
    require(initial[0]["last timestamp"] == 0);
    require(initial[0]["revision"] == 0);
    require(orders3::parse_store(initial.dump()) == initial);
    auto populated = initial;
    populated[0]["revision"] = std::numeric_limits<std::int64_t>::max();
    populated[0]["last timestamp"] = 9007199254740993LL;
    populated[0]["raw orders"].push_back({{"id", "9007199254740993"}});
    require(orders3::parse_store(populated.dump()) == populated);
    int rejected = 0;
    auto reject = [&](const std::string& input) {
        try { orders3::parse_store(input); }
        catch (const std::exception&) { ++rejected; return; }
        throw std::runtime_error("Accepted invalid storage");
    };
    for (const auto* text : {"", "null", "{}", "[]", "[{},{}]", "[1]",
             "[", "[{},]", "/*comment*/[]", "[] trailing",
             "[{\"revision\":0,\"revision\":1}]"}) reject(text);
    for (const auto* key : {"schema_version", "revision", "last timestamp"}) {
        auto missing = initial;
        missing[0].erase(key);
        reject(missing.dump());
        for (const auto& value : std::vector<json>{nullptr, true, "1", -1,
                 1.0, json::array(), json::object(), 9223372036854775808ULL}) {
            auto bad = initial;
            bad[0][key] = value;
            reject(bad.dump());
        }
    }
    for (const int version : {0, 2}) {
        auto bad = initial;
        bad[0]["schema_version"] = version;
        reject(bad.dump());
    }
    for (const auto* key : {"raw orders", "pending open orders",
             "finished open orders", "pending close orders",
             "finished close orders", "batches", "publish_intents",
             "close_tasks", "terminal_history", "workflow_runs"}) {
        auto bad = initial;
        bad[0].erase(key);
        reject(bad.dump());
        bad[0][key] = json::object();
        reject(bad.dump());
    }
    auto legacy = initial;
    legacy[0].erase("schema_version");
    legacy[0].erase("revision");
    reject(legacy.dump());
    require(initial == orders3::make_empty_store());
    std::cout << "Storage schema checks passed; " << rejected
              << " invalid documents rejected\n";
}
