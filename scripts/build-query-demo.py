"""生成可独立执行的 SQLite 查询及其结果快照，不依赖用户数据库。"""
import json
from pathlib import Path
import re
import sqlite3
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src" / "data"


def values_cte(name, columns, rows):
    def literal(value):
        return str(value) if isinstance(value, int) else "'" + value.replace("'", "''") + "'"

    values = ["        (" + ", ".join(map(literal, row)) + ")" for row in rows]
    return f"{name} ({', '.join(columns)}) AS (\n    VALUES\n" + ",\n".join(values) + "\n)"


def build_sql():
    regions = ["华东", "华南", "华北", "华中", "西南", "西北", "东北", "港澳"]
    channels = ["直营商城", "平台电商", "企业采购"]
    customers, orders, refunds = [], [], []
    for region_index, region in enumerate(regions):
        for channel_index, channel in enumerate(channels):
            for index in range(6):
                customer_id = 10001 + len(customers)
                customers.append((customer_id, region, channel, "企业" if index % 3 == 0 else "个人", f"2026-0{8 if index == 0 else 3}-01"))
                for month, batch in [(7, 0), (8, 1), (8, 2)]:
                    order_id = 900001 + len(orders)
                    paid = 12000 + region_index * 1800 + channel_index * 3200 + index * 2300 + batch * 1700
                    status = "cancelled" if order_id % 17 == 0 else "completed"
                    orders.append((order_id, customer_id, f"2026-{month:02d}-{2 + (index * 3 + batch * 5) % 26:02d}", status, paid, (index % 3) * 500))
                    if order_id % 9 == 0 and status == "completed":
                        refunds.append((700001 + len(refunds), order_id, "approved", paid // 2))

    header = """-- 月度经营分析 / 区域与渠道贡献
-- 统计周期：2026-08-01 至 2026-08-31；对照周期：2026-07
-- 口径：已完成订单、审核通过退款、按客户所属区域及渠道归集。
-- 金额源字段使用分，展示时统一换算为元并保留两位小数。
-- 单文件分析快照：下方 VALUES 为本次查询使用的脱敏样例数据。
-- SQL dialect: SQLite 3.25+ (CTE / window functions)

WITH
report_params AS (
    SELECT
        '2026-08-01' AS period_start,
        '2026-09-01' AS period_end,
        '2026-07-01' AS baseline_start
),

"""
    source = [
        "-- 01. 客户维度：地区、获客渠道、客户类型和注册日期\n" + values_cte("dim_customers", ["customer_id", "region_name", "channel_name", "customer_type", "registered_at"], customers),
        "-- 02. 订单明细：保留取消状态，用于核对后续有效订单口径\n" + values_cte("fact_orders", ["order_id", "customer_id", "paid_at", "order_status", "paid_cents", "coupon_cents"], orders),
        "-- 03. 退款明细：一笔订单可以关联多次退款，先聚合后关联\n" + values_cte("fact_refunds", ["refund_id", "order_id", "review_status", "refund_cents"], refunds),
    ]
    analysis = """
-- 04. 对账已审核退款，避免订单关联后发生金额倍增
approved_refunds AS (
    SELECT
        order_id,
        COUNT(*) AS refund_events,
        SUM(refund_cents) AS refund_cents
    FROM fact_refunds
    WHERE review_status = 'approved'
    GROUP BY order_id
),

-- 05. 订单清洗：限定报告与对照月份，剔除取消订单
eligible_orders AS (
    SELECT
        o.order_id,
        o.customer_id,
        o.paid_at,
        o.paid_cents,
        o.coupon_cents,
        COALESCE(r.refund_cents, 0) AS refund_cents,
        CASE WHEN r.order_id IS NOT NULL THEN 1 ELSE 0 END AS is_refunded,
        CASE
            WHEN o.paid_at >= p.period_start THEN 'current'
            ELSE 'baseline'
        END AS period_type
    FROM fact_orders AS o
    CROSS JOIN report_params AS p
    LEFT JOIN approved_refunds AS r ON r.order_id = o.order_id
    WHERE o.order_status = 'completed'
      AND o.paid_at >= p.baseline_start
      AND o.paid_at < p.period_end
      AND o.paid_cents > 0
),

-- 06. 归集经营维度，计算扣除退款后的净收入
order_dimensions AS (
    SELECT
        o.*,
        c.region_name,
        c.channel_name,
        c.customer_type,
        c.registered_at,
        o.paid_cents - o.refund_cents AS net_cents
    FROM eligible_orders AS o
    INNER JOIN dim_customers AS c ON c.customer_id = o.customer_id
),

-- 07. 当月客户粒度：为去重买家数、复购买家数提供依据
current_customer_metrics AS (
    SELECT
        region_name,
        channel_name,
        customer_id,
        COUNT(*) AS order_count,
        SUM(paid_cents) AS paid_cents,
        SUM(refund_cents) AS refund_cents,
        SUM(net_cents) AS net_cents,
        SUM(is_refunded) AS refund_orders,
        SUM(coupon_cents) AS coupon_cents,
        MAX(CASE WHEN customer_type = '企业' THEN 1 ELSE 0 END) AS is_enterprise,
        MAX(CASE WHEN registered_at >= p.period_start THEN 1 ELSE 0 END) AS is_new_customer
    FROM order_dimensions
    CROSS JOIN report_params AS p
    WHERE period_type = 'current'
    GROUP BY region_name, channel_name, customer_id
),

-- 08. 区域 × 渠道的本期经营汇总
current_summary AS (
    SELECT
        region_name,
        channel_name,
        SUM(order_count) AS paid_orders,
        COUNT(*) AS active_buyers,
        SUM(CASE WHEN order_count >= 2 THEN 1 ELSE 0 END) AS repeat_buyers,
        SUM(is_new_customer) AS new_buyers,
        SUM(is_enterprise) AS enterprise_buyers,
        SUM(paid_cents) AS paid_cents,
        SUM(refund_cents) AS refund_cents,
        SUM(net_cents) AS net_cents,
        SUM(refund_orders) AS refund_orders,
        SUM(coupon_cents) AS coupon_cents
    FROM current_customer_metrics
    GROUP BY region_name, channel_name
),

-- 09. 对照期采用完全相同的订单及退款口径
baseline_summary AS (
    SELECT
        region_name,
        channel_name,
        COUNT(*) AS baseline_orders,
        COUNT(DISTINCT customer_id) AS baseline_buyers,
        SUM(net_cents) AS baseline_net_cents
    FROM order_dimensions
    WHERE period_type = 'baseline'
    GROUP BY region_name, channel_name
),

-- 10. 补齐零交易分组，保证报告维度稳定
dimension_grid AS (
    SELECT DISTINCT region_name, channel_name
    FROM dim_customers
),
report_base AS (
    SELECT
        g.region_name,
        g.channel_name,
        COALESCE(c.paid_orders, 0) AS paid_orders,
        COALESCE(c.active_buyers, 0) AS active_buyers,
        COALESCE(c.repeat_buyers, 0) AS repeat_buyers,
        COALESCE(c.new_buyers, 0) AS new_buyers,
        COALESCE(c.enterprise_buyers, 0) AS enterprise_buyers,
        COALESCE(c.paid_cents, 0) AS paid_cents,
        COALESCE(c.refund_cents, 0) AS refund_cents,
        COALESCE(c.net_cents, 0) AS net_cents,
        COALESCE(c.refund_orders, 0) AS refund_orders,
        COALESCE(c.coupon_cents, 0) AS coupon_cents,
        COALESCE(b.baseline_orders, 0) AS baseline_orders,
        COALESCE(b.baseline_buyers, 0) AS baseline_buyers,
        COALESCE(b.baseline_net_cents, 0) AS baseline_net_cents
    FROM dimension_grid AS g
    LEFT JOIN current_summary AS c
        ON c.region_name = g.region_name
       AND c.channel_name = g.channel_name
    LEFT JOIN baseline_summary AS b
        ON b.region_name = g.region_name
       AND b.channel_name = g.channel_name
),

-- 11. 派生指标：客单价、退款率、复购率、净收入环比
report_metrics AS (
    SELECT
        *,
        ROUND(paid_cents / 100.0, 2) AS paid_amount,
        ROUND(refund_cents / 100.0, 2) AS refund_amount,
        ROUND(net_cents / 100.0, 2) AS net_revenue,
        ROUND(net_cents / 100.0 / NULLIF(paid_orders, 0), 2) AS avg_order_value,
        ROUND(100.0 * refund_orders / NULLIF(paid_orders, 0), 2) AS refund_rate_pct,
        ROUND(100.0 * repeat_buyers / NULLIF(active_buyers, 0), 2) AS repeat_rate_pct,
        ROUND(100.0 * (net_cents - baseline_net_cents) / NULLIF(baseline_net_cents, 0), 2) AS mom_growth_pct
    FROM report_base
),

-- 12. 窗口分析：全局贡献率、区域内排序、累计收入占比
ranked_report AS (
    SELECT
        *,
        DENSE_RANK() OVER (
            ORDER BY net_cents DESC
        ) AS revenue_rank,
        ROW_NUMBER() OVER (
            PARTITION BY region_name
            ORDER BY net_cents DESC, channel_name
        ) AS region_rank,
        ROUND(100.0 * net_cents / NULLIF(SUM(net_cents) OVER (), 0), 2) AS revenue_share_pct,
        ROUND(
            100.0 * SUM(net_cents) OVER (
                ORDER BY net_cents DESC, region_name, channel_name
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) / NULLIF(SUM(net_cents) OVER (), 0),
            2
        ) AS cumulative_share_pct
    FROM report_metrics
)

-- 13. 输出：金额单位元，比例字段单位 %，按净收入降序
SELECT
    '2026-08' AS report_month,
    region_name,
    channel_name,
    paid_orders,
    active_buyers,
    new_buyers,
    paid_amount,
    refund_amount,
    net_revenue,
    avg_order_value,
    refund_rate_pct,
    repeat_rate_pct,
    mom_growth_pct,
    revenue_share_pct,
    cumulative_share_pct,
    revenue_rank,
    region_rank
FROM ranked_report
ORDER BY net_cents DESC, region_name, channel_name;
"""
    # SQLite 支持前向引用 CTE，将分析逻辑放在开头，输入明细放在后面便于审阅。
    body, output = analysis.split("-- 13. 输出", 1)
    sql = header + body.strip() + ",\n\n" + ",\n\n".join(source) + "\n\n-- 13. 输出" + output
    return re.sub(r"-- \d+\. ", "-- ", sql)


def main():
    sql = build_sql()
    with sqlite3.connect(":memory:") as connection:
        started = time.perf_counter()
        cursor = connection.execute(sql)
        rows = cursor.fetchall()
        elapsed = round((time.perf_counter() - started) * 1000, 2)
        names = [item[0] for item in cursor.description]
    decimal_columns = {"paid_amount", "refund_amount", "net_revenue", "avg_order_value"}
    columns = [{"name": name, "type": "TEXT" if index < 3 else "DECIMAL" if name in decimal_columns or name.endswith("_pct") else "INTEGER"} for index, name in enumerate(names)]
    result = {"columns": columns, "rows": rows, "elapsedMs": elapsed}
    if "--check" in sys.argv:
        stored = json.loads((TARGET / "query-demo.json").read_text(encoding="utf-8"))
        assert (TARGET / "query-demo.sql").read_text(encoding="utf-8") == sql
        assert stored["columns"] == columns and stored["rows"] == [list(row) for row in rows]
    else:
        TARGET.mkdir(parents=True, exist_ok=True)
        (TARGET / "query-demo.sql").write_bytes(sql.encode("utf-8"))
        (TARGET / "query-demo.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"SQL 与结果一致：{len(sql.splitlines())} 行 SQL，{len(rows)} 行结果，{len(columns)} 个字段。")


if __name__ == "__main__":
    main()
