#pragma once
#include <QString>
#include <stdexcept>

namespace orders {
class Error : public std::runtime_error {
public:
    explicit Error(const QString &message) : std::runtime_error(message.toUtf8().constData()) {}
};
} // namespace orders
