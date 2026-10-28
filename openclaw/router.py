import calendar
import re
from datetime import date
import json

import frappe
try:
    import google.generativeai as genai
except ImportError:
    genai = None

from openclaw.skills.profit_loss import execute
from openclaw.skills.sales import execute as execute_sales

def detect_language(text):
    # Basic detection: check for Tamil unicode characters or Tanglish keywords
    text_lower = text.lower()
    if any(char >= '\u0B80' and char <= '\u0BFF' for char in text):
        return 'ta'
    
    tanglish_keywords = ['evlo', 'evlo?', 'sollu', 'sollu?', 'ennathu', 'enna', 'laabam', 'nattam', 'varavu', 'selavu', 'virpanai']
    if any(word in text_lower for word in tanglish_keywords):
        return 'ta'
        
    return 'en'


MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def handle_request(
    question,
    company="ABC",
    from_date=None,
    to_date=None,
    from_fiscal_year=None,
    to_fiscal_year=None,
    chat_history=None,
    report_data=None,
    session_id=None,
):
    if session_id:
        doc = frappe.new_doc("OpenClaw Chat Message")
        doc.session = session_id
        doc.sender = "You"
        doc.type = "openclaw-user"
        doc.message = question
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

    result = _handle_request(
        question,
        company,
        from_date,
        to_date,
        from_fiscal_year,
        to_fiscal_year,
        chat_history,
        report_data,
        session_id,
    )

    if session_id:
        answer = result.get("answer") or result.get("message", "")
        if answer:
            doc = frappe.new_doc("OpenClaw Chat Message")
            doc.session = session_id
            doc.sender = "OpenClaw"
            doc.type = "openclaw-bot"
            doc.message = answer
            doc.insert(ignore_permissions=True)
            frappe.db.commit()

    return result

def _handle_request(
    question,
    company="ABC",
    from_date=None,
    to_date=None,
    from_fiscal_year=None,
    to_fiscal_year=None,
    chat_history=None,
    report_data=None,
    session_id=None,
):

    api_key = frappe.conf.get("openclaw_gemini_api_key")
    if api_key and genai:
        return handle_llm_request(
            question,
            company,
            from_date,
            to_date,
            session_id,
            report_data,
            api_key
        )

    if not from_date or not to_date:
        if from_fiscal_year:
            to_fy = to_fiscal_year or from_fiscal_year
            fy_start = frappe.db.get_value("Fiscal Year", from_fiscal_year, "year_start_date")
            fy_end = frappe.db.get_value("Fiscal Year", to_fy, "year_end_date")
            if fy_start:
                from_date = str(fy_start)
            if fy_end:
                to_date = str(fy_end)

    question_lower = question.lower()
    lang = detect_language(question)

    # -------------------------
    # SALES
    # -------------------------
    if any(
        word in question_lower
        for word in [
            "sales",
            "sale",
            "sold",
            "selling",
            "virpanai",
            "விற்பனை",
        ]
    ):
        result = handle_sales(
            question,
            company=company,
            from_date=from_date,
            to_date=to_date,
        )
        result["language"] = lang

        return {
            "skill": "sales",
            "answer": format_result(result),
            "result": result,
        }

    # -------------------------
    # PROFIT / LOSS / MISMATCH / MONTH ROUTING
    # -------------------------
    if any(
        word in question_lower
        for word in [
            "profit",
            "profit loss",
            "income",
            "expense",
            "expenses",
            "revenue",
            "mismatch",
            "mismatches",
            "data mismatch",
            "data mismatches",
            "anomaly",
            "anomalies",
            "difference",
            "laabam",
            "லாபம்",
            "இலாபம்",
            "nattam",
            "நஷ்டம்",
            "varavu",
            "வரவு",
            "selavu",
            "செலவு",
            "traffic",
            "டிராபிக்",
            "profile",
            "பிராஃபைல்",
            "பிராபிட்",
            "பிராஃபிட்",
            "mis match",
            "ledger mismatch",
            "gl mismatch",
            "invoice mismatch",
            "பிழை",
            "தவறு",
            "katuthu",
            "காட்டுது",
            "katutho",
            "maari",
        ]
    ) or any(month in question_lower for month in MONTHS.keys()):
        result = handle_profit_loss(
            question,
            company=company,
            from_date=from_date,
            to_date=to_date,
        )
        result["language"] = lang

        return {
            "skill": "profit_loss",
            "answer": format_result(result),
            "result": result,
        }

    return {
        "skill": None,
        "message": "I don't know which skill to use for this question.",
    }


def handle_profit_loss(
    question,
    company="ABC",
    from_date=None,
    to_date=None,
):
    ex_from, ex_to = extract_date_range(question)
    if ex_from and ex_to:
        from_date = ex_from
        to_date = ex_to
    elif not from_date or not to_date:
        from_date = "2026-04-01"
        to_date = "2027-03-31"

    result = execute(
        company=company,
        from_date=from_date,
        to_date=to_date,
        question=question,
    )

    question_lower = question.lower()

    mismatches = result.get("mismatches", [])

    if any(word in question_lower for word in ["mismatch", "mismatches", "data mismatch"]):
        return {
            "type": "mismatch",
            "value": result["profit"],
            "from_date": result["from_date"],
            "to_date": result["to_date"],
            "mismatches": mismatches,
        }

    if any(word in question_lower for word in ["income", "revenue", "varavu", "வரவு"]):
        return {
            "type": "income",
            "value": result["income"],
            "from_date": result["from_date"],
            "to_date": result["to_date"],
            "mismatches": mismatches,
        }

    if any(word in question_lower for word in ["expense", "expenses", "selavu", "செலவு"]):
        return {
            "type": "expense",
            "value": result["expense"],
            "from_date": result["from_date"],
            "to_date": result["to_date"],
            "mismatches": mismatches,
        }

    return {
        "type": "profit",
        "value": result["profit"],
        "from_date": result["from_date"],
        "to_date": result["to_date"],
        "mismatches": mismatches,
    }


def handle_sales(
    question,
    company="ABC",
    from_date=None,
    to_date=None,
):
    ex_from, ex_to = extract_date_range(question)
    if ex_from and ex_to:
        from_date = ex_from
        to_date = ex_to
    elif not from_date or not to_date:
        from_date = "2026-04-01"
        to_date = "2027-03-31"

    return execute_sales(
        company=company,
        from_date=from_date,
        to_date=to_date,
    )


def extract_date_range(question):
    question_lower = question.lower()

    year_match = re.search(r"\b(20\d\d)\b", question_lower)
    if year_match:
        current_year = int(year_match.group(1))
    else:
        current_year = date.today().year

    today_str = date.today().isoformat()
    if any(w in question_lower for w in ["today", "டுடே", "இன்னைக்கு", "இன்று"]):
        return today_str, today_str

    # Date range pattern: e.g. "january to march"
    pattern = (
        r"(january|february|march|april|may|june|july|august|"
        r"september|october|november|december)"
        r"\s+(?:to|-)\s+"
        r"(january|february|march|april|may|june|july|august|"
        r"september|october|november|december)"
    )

    match = re.search(pattern, question_lower)
    if match:
        start_month = MONTHS[match.group(1)]
        end_month = MONTHS[match.group(2)]

        from_date = date(current_year, start_month, 1)
        last_day = calendar.monthrange(current_year, end_month)[1]
        to_date = date(current_year, end_month, last_day)

        return from_date.isoformat(), to_date.isoformat()

    # Single month pattern: e.g. "january", "january month", "january profit"
    single_pattern = (
        r"\b(january|february|march|april|may|june|july|august|"
        r"september|october|november|december)\b"
    )
    single_match = re.search(single_pattern, question_lower)
    if single_match:
        month_name = single_match.group(1)
        month_num = MONTHS[month_name]
        from_date = date(current_year, month_num, 1)
        last_day = calendar.monthrange(current_year, month_num)[1]
        to_date = date(current_year, month_num, last_day)

        return from_date.isoformat(), to_date.isoformat()

    return None, None


def format_result(result):
    result_type = result.get("type")
    value = result.get("value", 0)
    from_date = result.get("from_date")
    to_date = result.get("to_date")
    lang = result.get("language", "en")
    mismatches = result.get("mismatches", [])

    mismatch_lines = []
    if mismatches:
        for i, m in enumerate(mismatches, start=1):
            item_idx = m.get("idx", i)
            mismatch_lines.append(
                f"{item_idx}. Sales Invoice {m['name']} Grand/Rounded Total (₹{m['grand_total']:,.2f}) does not match Debtors ledger posting (₹{m['gl_total']:,.2f}) on {m['posting_date']}."
            )
    mismatch_str = ("\n\n" + "\n".join(mismatch_lines)) if mismatch_lines else "\n\nNo data mismatches found for this period."

    if lang == "ta":
        if result_type == "mismatch":
            return (
                f"{from_date} முதல் {to_date} வரையிலான Data Mismatch விவரங்கள்:{mismatch_str}"
            )

        if result_type == "profit":
            return (
                f"{from_date} முதல் {to_date} வரையிலான உங்கள் லாபம் "
                f"₹{value:,.2f} ஆகும்.{mismatch_str}"
            )

        if result_type == "income":
            return (
                f"{from_date} முதல் {to_date} வரையிலான உங்கள் வருமானம் "
                f"₹{value:,.2f} ஆகும்.{mismatch_str}"
            )

        if result_type == "expense":
            return (
                f"{from_date} முதல் {to_date} வரையிலான உங்கள் செலவு "
                f"₹{value:,.2f} ஆகும்.{mismatch_str}"
            )

        if result_type == "sales":
            return (
                f"{from_date} முதல் {to_date} வரையிலான உங்கள் விற்பனை "
                f"₹{value:,.2f} ஆகும்.{mismatch_str}"
            )

        return "பதிலைக் கண்டேன், ஆனால் அதை வடிவமைக்க முடியவில்லை."

    # English fallback
    if result_type == "mismatch":
        return (
            f"Data Mismatches from {from_date} to {to_date}:{mismatch_str}"
        )

    if result_type == "profit":
        return (
            f"Your profit from {from_date} to {to_date} "
            f"is ₹{value:,.2f}.{mismatch_str}"
        )

    if result_type == "income":
        return (
            f"Your income from {from_date} to {to_date} "
            f"is ₹{value:,.2f}.{mismatch_str}"
        )

    if result_type == "expense":
        return (
            f"Your expenses from {from_date} to {to_date} "
            f"are ₹{value:,.2f}.{mismatch_str}"
        )

    if result_type == "sales":
        return (
            f"Your sales from {from_date} to {to_date} "
            f"are ₹{value:,.2f}.{mismatch_str}"
        )

    return "I found the result, but I could not format it."


def handle_llm_request(question, company, from_date, to_date, session_id, report_data_str, api_key):
    genai.configure(api_key=api_key)
    
    history = []
    if session_id:
        messages = frappe.get_all(
            "OpenClaw Chat Message",
            filters={"session": session_id},
            fields=["sender", "message", "type"],
            order_by="creation asc"
        )
        for msg in messages:
            role = "user" if msg.type == "openclaw-user" else "model"
            history.append({
                "role": role,
                "parts": [msg.message]
            })

    system_instruction = f"""
    You are OpenClaw, a highly intelligent Financial Assistant integrated into ERPNext.
    You assist the user with analyzing their Profit and Loss statement, finding mismatches, and explaining them.
    Company: {company}
    
    Current Report Data (JSON):
    {report_data_str[:10000]} # Trimmed to avoid exceeding context window if too large
    
    Instructions:
    1. Answer the user's questions based on the provided report data.
    2. If the user asks about a mismatch or anomaly, explain the line items and suggest a solution.
    3. Respond in the language the user asks the question in (Tamil or English). 
    4. Keep answers concise but informative. Do not use markdown styling like bold or italics as the UI may not support it perfectly.
    """

    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash", 
        system_instruction=system_instruction
    )
    
    if history and history[-1]["role"] == "user":
        last_question = history.pop()["parts"][0]
    else:
        last_question = question
        
    try:
        chat = model.start_chat(history=history)
        response = chat.send_message(last_question)
        return {"answer": response.text}
    except Exception as e:
        return {"answer": f"Error from AI: {str(e)}"}

