# 抓取与跟踪订单设计草稿

以下内容从 fetcher.cpp 的未完成注释迁入，保留原文供后续讨论；属于设计资料，不代表本次重构已实现的功能。

现有网页每 15 秒读取本地快照，远程抓取由手动刷新和 Cron 调度触发。每分钟独立获取 Gate 订单需要在调度层设计。

创建、停止交易订单的参数、状态范围、失败补偿和幂等策略尚需明确；原文的 timestamp小于7 未说明时间单位及比较方式。

## 原始笔记

~~~text
/*
    对应的E:\git\0AAimportant\c\orders3\web\index.html  从来源内容解析订单 · 每 15 秒同步本地数据 这好像没有函数声明每15秒同步本地数据吧
    需要被修改
    */

/*
    list函数每隔1分钟不间断轮询(与其他函数运行平率独立)
    对应的E:\git\0AAimportant\c\orders3\web\index.html  从 Gate 获取跟踪订单 · 每 15 秒同步本地数据 需要被修改
    */

/*

key="YOUR_API_KEY"
secret="YOUR_API_SECRET"
host="https://api.gateio.ws"
prefix="/api/v4"
method="POST"
url="/futures/usdt/autoorder/v1/trail/create"
query_param=""
body_param='{"contract":"BTC_USDT","amount":"10","activation_price":"50000","is_gte":true,"price_type":1,"price_offset":"0.1%","reduce_only":false,"text":"apiv4"}'
timestamp=$(date +%s)
body_hash=$(printf "$body_param" | openssl sha512 | awk '{print $NF}')
sign_string="$method\n$prefix$url\n$query_param\n$body_hash\n$timestamp"
sign=$(printf "$sign_string" | openssl sha512 -hmac "$secret" | awk '{print $NF}')

full_url="$host$prefix$url"
curl -X $method $full_url -d "$body_param" -H "Content-Type: application/json" \
    -H "Timestamp: $timestamp" -H "KEY: $key" -H "SIGN: $sign"

完善这个函数
使用url = '/futures/usdt/autoorder/v1/trail/create'函数创建追踪订单时
使用url = '/futures/usdt/autoorder/v1/trail/create'函数时 进行分类讨论

1.当data.db的orderslist table还有订单 且 reduce_only = 1 且 original_status =1或2 时
先对使用url = '/futures/usdt/autoorder/v1/trail/stop'对旧追踪订单对应id发布停止追踪订单操作
然后使用url = '/futures/usdt/autoorder/v1/trail/create'函数发布追踪订单操作

2.当data.db的orders table 和 data.db的orderslist table 的contract与contract一致 amount和amount同为正负或负数时 且 俩者timestamp小于7时(注意: data.db的orders table对应amount的值不是整数.而是带了contract单位的string .因此比较是否同为正负数时需要注意处理)
跳过抓取数据操作


    */
~~~
