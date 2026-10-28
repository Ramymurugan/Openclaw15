import frappe

from openclaw.router import handle_request
from openclaw.skills.profit_loss import execute




@frappe.whitelist(allow_guest=True)
def get_profit_loss(
    company="ABC",
    from_date="2026-04-01",
    to_date="2026-08-20",
    **kwargs,
):
    return execute(company, from_date, to_date)


@frappe.whitelist(allow_guest=True)
def ask(
    question,
    company="ABC",
    from_date=None,
    to_date=None,
    from_fiscal_year=None,
    to_fiscal_year=None,
    chat_history=None,
    report_data=None,
    session_id=None,
    **kwargs,
):
    return handle_request(
        question,
        company=company,
        from_date=from_date,
        to_date=to_date,
        from_fiscal_year=from_fiscal_year,
        to_fiscal_year=to_fiscal_year,
        chat_history=chat_history,
        report_data=report_data,
        session_id=session_id,
    )

@frappe.whitelist(allow_guest=True)
def get_sessions():
    user = frappe.session.user if frappe.session else "Guest"
    sessions = frappe.get_all(
        "OpenClaw Chat Session",
        filters={"user": user},
        fields=["name as id", "title", "creation as timestamp"],
        order_by="creation desc"
    )
    valid_sessions = []
    for s in sessions:
        msg_count = frappe.db.count("OpenClaw Chat Message", {"session": s["id"]})
        if msg_count > 0:
            valid_sessions.append(s)
        else:
            try:
                frappe.delete_doc("OpenClaw Chat Session", s["id"], ignore_permissions=True)
            except Exception:
                pass
    frappe.db.commit()
    return valid_sessions

@frappe.whitelist(allow_guest=True)
def get_messages(session_id):
    if not frappe.db.exists("OpenClaw Chat Session", session_id):
        return []
    
    user = frappe.session.user if frappe.session else "Guest"
    owner = frappe.db.get_value("OpenClaw Chat Session", session_id, "user")
    if owner and owner != user and user != "Administrator":
        return []

    return frappe.get_all(
        "OpenClaw Chat Message",
        filters={"session": session_id},
        fields=["sender", "message", "type"],
        order_by="creation asc"
    )

@frappe.whitelist(allow_guest=True)
def create_session(title="New Chat"):
    user = frappe.session.user if frappe.session else "Guest"
    doc = frappe.new_doc("OpenClaw Chat Session")
    doc.title = title
    doc.user = user
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name

@frappe.whitelist(allow_guest=True)
def rename_session(session_id, title):
    user = frappe.session.user if frappe.session else "Guest"
    owner = frappe.db.get_value("OpenClaw Chat Session", session_id, "user")
    if not owner or owner == user or user == "Administrator":
        frappe.db.set_value("OpenClaw Chat Session", session_id, "title", title)
        frappe.db.commit()
        return True
    return False
