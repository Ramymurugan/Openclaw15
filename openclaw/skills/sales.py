import frappe


def resolve_company(company=None):
    if company and company != "ABC" and frappe.db.exists("Company", company):
        return company

    default_comp = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
    if default_comp and frappe.db.exists("Company", default_comp):
        return default_comp

    companies = frappe.get_all("Company", limit=1, pluck="name")
    if companies:
        return companies[0]

    return None


def execute(
    company=None,
    from_date="2026-04-01",
    to_date="2026-08-20",
):
    target_company = resolve_company(company)

    query = """
        SELECT COALESCE(SUM(base_net_total), 0)
        FROM `tabSales Invoice`
        WHERE posting_date BETWEEN %s AND %s
        AND docstatus = 1
    """
    params = [from_date, to_date]
    if target_company:
        query += " AND company = %s"
        params.append(target_company)

    sales = frappe.db.sql(query, tuple(params))[0][0]

    sales = float(sales or 0)

    return {
        "type": "sales",
        "value": sales,
        "from_date": from_date,
        "to_date": to_date,
    }
