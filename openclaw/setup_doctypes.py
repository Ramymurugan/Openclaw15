import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

def create_doctypes():
    frappe.flags.in_install = True

    if not frappe.db.exists("DocType", "OpenClaw Chat Session"):
        doc = frappe.new_doc("DocType")
        doc.name = "OpenClaw Chat Session"
        doc.module = "Openclaw"
        doc.custom = 0
        doc.istable = 0
        doc.autoname = "naming_series:"
        doc.naming_rule = "By " + '"Naming Series" field'
        
        fields = [
            {"fieldname": "naming_series", "label": "Naming Series", "fieldtype": "Select", "options": "OC-CHAT-", "default": "OC-CHAT-", "reqd": 1, "hidden": 1},
            {"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "default": frappe.session.user, "in_list_view": 1},
        ]
        for f in fields:
            doc.append("fields", f)
            
        doc.insert(ignore_permissions=True)
        print("Created OpenClaw Chat Session")
    
    if not frappe.db.exists("DocType", "OpenClaw Chat Message"):
        doc = frappe.new_doc("DocType")
        doc.name = "OpenClaw Chat Message"
        doc.module = "Openclaw"
        doc.custom = 0
        doc.istable = 0
        doc.autoname = "hash"
        
        fields = [
            {"fieldname": "session", "label": "Session", "fieldtype": "Link", "options": "OpenClaw Chat Session", "reqd": 1, "in_list_view": 1},
            {"fieldname": "sender", "label": "Sender", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "type", "label": "Message Type", "fieldtype": "Data", "reqd": 1},
            {"fieldname": "message", "label": "Message", "fieldtype": "Long Text", "reqd": 1},
        ]
        for f in fields:
            doc.append("fields", f)
            
        doc.insert(ignore_permissions=True)
        print("Created OpenClaw Chat Message")
    else:
        # Ensure fieldtype is updated to Long Text for existing DocType
        doc = frappe.get_doc("DocType", "OpenClaw Chat Message")
        updated = False
        for f in doc.fields:
            if f.fieldname == "message" and f.fieldtype != "Long Text":
                f.fieldtype = "Long Text"
                updated = True
        if updated:
            doc.save(ignore_permissions=True)
            print("Updated OpenClaw Chat Message fieldtype to Long Text")
        
    frappe.db.commit()
