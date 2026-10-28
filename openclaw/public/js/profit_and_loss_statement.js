frappe.provide("openclaw");

console.log("OpenClaw: profit_and_loss_statement.js has been loaded in the browser.");


/* =========================================================
   ADD ASK OPENCLAW BUTTON
   ========================================================= */

openclaw.is_allowed_report = function () {
    const route = frappe.get_route();
    if (!route || route[0] !== "query-report") {
        return false;
    }
    return true;
};

openclaw.add_profit_loss_button = function () {

    const route = frappe.get_route();
    console.log("OpenClaw: add_profit_loss_button called. Route:", route);

    openclaw.add_chat_styles();

    if (!openclaw.is_allowed_report()) {
        return;
    }

    console.log("OpenClaw: Route matches. query_report status:", !!frappe.query_report, !!(frappe.query_report && frappe.query_report.page));

    if (!frappe.query_report || !frappe.query_report.page) {
        return;
    }

    /*
     * Already exists
     */
    if ($(".openclaw-ask-button").length) {
        return;
    }

    console.log("OpenClaw: Creating button");

    const button =
        frappe.query_report.page.add_inner_button(
            __("Ask OpenClaw"),
            function () {
                openclaw.open_chat();
            }
        );

    button.addClass("openclaw-ask-button");

    /*
     * Force button visibility
     */
    button.css({
        display: "inline-block",
        visibility: "visible",
        opacity: "1"
    });
};


/* =========================================================
   OPEN CHAT
   ========================================================= */

openclaw.open_chat = function () {

    const filters =
        (frappe.query_report && frappe.query_report.get_filter_values)
            ? frappe.query_report.get_filter_values()
            : {};

    const from_date =
        filters.period_start_date || filters.from_date || filters.report_date;

    const to_date =
        filters.period_end_date || filters.to_date || filters.report_date;

    const company =
        filters.company || "ABC";

    const from_fiscal_year =
        filters.from_fiscal_year || filters.fiscal_year;

    const to_fiscal_year =
        filters.to_fiscal_year || filters.fiscal_year;


    const dialog =
        new frappe.ui.Dialog({

            title: __("OpenClaw AI"),

            size: "extra-large",

            fields: [
                {
                    fieldname: "chat_area",
                    fieldtype: "HTML"
                }
            ],

            primary_action_label: __("Close"),

            primary_action: function () {
                dialog.hide();
            }

        });


    dialog.show();


    let chat_sessions = [];
    let current_session_id = null;
    let chat_history = [];

    const wrapper =
        dialog.fields_dict.chat_area.$wrapper;


    wrapper.html(`
        <div class="openclaw-container">
            <div class="openclaw-sidebar">
                <div class="openclaw-sidebar-header">
                    <button id="openclaw-new-chat" class="btn">+ New Chat</button>
                </div>
                <div class="openclaw-history-list" id="openclaw-history-list">
                    <!-- Sessions injected here -->
                </div>
                <div class="openclaw-sidebar-footer">
                    <span class="openclaw-status-dot"></span> Administrator
                </div>
            </div>

            <div class="openclaw-chat">
                <div class="openclaw-messages" id="openclaw-messages"></div>

                <div class="openclaw-voice-visualizer" id="openclaw-voice-visualizer">
                    <span class="visualizer-text">Listening...</span>
                    <div class="voice-bar bar1"></div>
                    <div class="voice-bar bar2"></div>
                    <div class="voice-bar bar3"></div>
                    <div class="voice-bar bar4"></div>
                    <div class="voice-bar bar5"></div>
                </div>

                <div class="openclaw-input-area">
                    <input type="text" id="openclaw-question" class="form-control" placeholder="Ask about profit, loss, or sales..." autocomplete="off">
                    <button type="button" id="openclaw-mic" class="btn openclaw-mic" title="Voice input">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="openclaw-mic-svg">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                            <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                    </button>
                    <button type="button" id="openclaw-send" class="btn openclaw-send">Send</button>
                </div>
            </div>
        </div>
    `);


    openclaw.add_chat_styles();


    const question_input =
        wrapper.find("#openclaw-question");

    const send_button =
        wrapper.find("#openclaw-send");

    const mic_button =
        wrapper.find("#openclaw-mic");

    const messages =
        wrapper.find("#openclaw-messages");

    const voice_visualizer =
        wrapper.find("#openclaw-voice-visualizer");

    function add_message(
        sender,
        message,
        type,
        save = true,
        speak = false
    ) {

        if (!message || !message.trim()) {
            return;
        }

        const clean_msg = frappe.utils.escape_html((message || "").trim());
        const msg_html = `<div class="openclaw-message ${type}"><div class="openclaw-message-content">${clean_msg}</div></div>`;

        messages.append(msg_html);
        messages.scrollTop(
            messages[0].scrollHeight
        );


        if (save && !type.includes("openclaw-thinking") && type !== "openclaw-bot-typing") {
            chat_history.push({
                sender: sender,
                message: message,
                type: type
            });
            
            const session = chat_sessions.find(s => s.id === current_session_id);
            if (session) {
                if (chat_history.length === 1 && sender === "You") {
                    session.title = message.substring(0, 30) + (message.length > 30 ? "..." : "");
                    frappe.call({
                        method: "openclaw.api.rename_session",
                        args: { session_id: current_session_id, title: session.title }
                    });
                }
            }
            render_sidebar();
        }

        if (speak && "speechSynthesis" in window) {
            const utterance = new SpeechSynthesisUtterance(message);
            // Detect if message has Tamil characters
            if (/[\u0B80-\u0BFF]/.test(message)) {
                utterance.lang = "ta-IN";
            } else {
                utterance.lang = "en-IN";
            }
            window.speechSynthesis.speak(utterance);
        }
    }

    const history_list = wrapper.find("#openclaw-history-list");
    
    function render_sidebar() {
        history_list.empty();
        chat_sessions.forEach(session => {
            const active_class = session.id === current_session_id ? "active" : "";
            const chat_icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="openclaw-chat-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
            history_list.append(`
                <div class="openclaw-session-item ${active_class}" data-id="${session.id}">
                    ${chat_icon}
                    <div class="openclaw-session-title">${frappe.utils.escape_html(session.title)}</div>
                </div>
            `);
        });
        
        history_list.find(".openclaw-session-item").on("click", function() {
            const id = $(this).data("id").toString();
            load_session(id);
        });
    }

    function load_session(id) {
        current_session_id = id;
        
        messages.empty();
        frappe.call({
            method: "openclaw.api.get_messages",
            args: { session_id: id },
            callback: function(r) {
                chat_history = r.message || [];
                if (chat_history.length > 0) {
                    chat_history.forEach(msg => {
                        add_message(msg.sender, msg.message, msg.type, false, false);
                    });
                } else {
                    add_message("OpenClaw", "Hello! How can I help you?", "openclaw-bot", false, false);
                }
            }
        });
        
        render_sidebar();
    }

    function start_new_chat() {
        if (chat_history.length === 0 && current_session_id) {
            messages.empty();
            add_message("OpenClaw", "Hello! How can I help you?", "openclaw-bot", false, false);
            return;
        }

        frappe.call({
            method: "openclaw.api.create_session",
            args: { title: "New Chat" },
            callback: function(r) {
                if (r.message) {
                    current_session_id = r.message;
                    chat_sessions.unshift({
                        id: current_session_id,
                        title: "New Chat"
                    });
                    load_session(current_session_id);
                }
            }
        });
    }
    
    wrapper.find("#openclaw-new-chat").on("click", start_new_chat);

    frappe.call({
        method: "openclaw.api.get_sessions",
        callback: function(r) {
            if (r.message && r.message.length > 0) {
                chat_sessions = r.message;
                load_session(chat_sessions[0].id);
            } else {
                start_new_chat();
            }
        }
    });


    function ask_openclaw() {

        const question =
            question_input.val().trim();


        if (!question) {
            return;
        }


        add_message(
            "You",
            question,
            "openclaw-user",
            true, // save
            false // speak
        );


        question_input.val("");


        add_message(
            "OpenClaw",
            "Thinking...",
            "openclaw-bot openclaw-thinking",
            false,
            false
        );


        frappe.call({

            method: "openclaw.api.ask",

            args: {

                question: question,

                company: company,

                from_date: from_date,

                to_date: to_date,

                from_fiscal_year: from_fiscal_year,

                to_fiscal_year: to_fiscal_year,

                session_id: current_session_id,

                report_data: JSON.stringify(frappe.query_report.data || [])

            },


            callback: function (r) {

                messages
                    .find(".openclaw-thinking")
                    .remove();


                if (
                    r.message &&
                    r.message.answer
                ) {

                    add_message(
                        "OpenClaw",
                        r.message.answer,
                        "openclaw-bot",
                        true,
                        true
                    );

                } else {

                    add_message(
                        "OpenClaw",
                        "Sorry, I could not find an answer.",
                        "openclaw-bot",
                        true,
                        true
                    );

                }

            },


            error: function () {

                messages
                    .find(".openclaw-thinking")
                    .remove();


                add_message(
                    "OpenClaw",
                    "Something went wrong while processing your question.",
                    "openclaw-bot",
                    true,
                    true
                );

            }

        });

    }


    send_button.on(
        "click",
        ask_openclaw
    );


    question_input.on(
        "keypress",
        function (e) {

            if (e.which === 13) {

                e.preventDefault();

                ask_openclaw();

            }

        }
    );


    /* =====================================================
       VOICE
       ===================================================== */

    mic_button.on(
        "click",
        function () {

            const SpeechRecognition =
                window.SpeechRecognition ||
                window.webkitSpeechRecognition;


            if (!SpeechRecognition) {

                frappe.msgprint({
                    title: __("Voice Input"),

                    message: __(
                        "Voice input is not supported by this browser."
                    ),

                    indicator: "orange"
                });

                return;
            }


            const recognition =
                new SpeechRecognition();


            const lang_select = wrapper.find("#openclaw-lang-select").val() || "ta-IN";
            recognition.lang = lang_select;

            recognition.interimResults =
                false;

            recognition.continuous =
                false;


            mic_button.addClass("listening");
            voice_visualizer.addClass("active");

            recognition.start();


            recognition.onresult =
                function (event) {

                    const transcript =
                        event.results[0][0].transcript;

                    question_input.val(
                        transcript
                    );

                    ask_openclaw();

                };


            recognition.onerror =
                function () {

                    mic_button.removeClass("listening");
                    voice_visualizer.removeClass("active");

                    frappe.msgprint({
                        title: __("Voice Input"),

                        message: __(
                            "Could not understand the voice input."
                        ),

                        indicator: "orange"
                    });

                };


            recognition.onend =
                function () {

                    mic_button.removeClass("listening");
                    voice_visualizer.removeClass("active");

                };

        }
    );


    setTimeout(
        function () {
            question_input.focus();
        },
        300
    );

};


/* =========================================================
   CHAT CSS
   ========================================================= */

openclaw.add_chat_styles = function () {

    $("#openclaw-chat-styles").remove();


    $("head").append(`

        <style id="openclaw-chat-styles">

            /* Ask OpenClaw Button & Custom Actions */

            body[data-route^="query-report/"] .custom-actions {
                display: flex !important;
            }

            .openclaw-ask-button {
                display: inline-block !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: relative !important;
                z-index: 1000 !important;
            }


            /* Container layout */
            .openclaw-container {
                display: flex;
                width: 100%;
                min-height: 560px;
                background: #ffffff;
                border-radius: 12px;
                overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            .openclaw-sidebar {
                width: 250px;
                background: #f8f9fe;
                border-right: 1px solid #e5e7eb;
                display: flex;
                flex-direction: column;
                padding: 16px 0 0 0;
            }

            .openclaw-sidebar-header {
                padding: 0 16px 16px 16px;
            }
            
            #openclaw-new-chat {
                background: #5046e6;
                border: none;
                color: #ffffff;
                border-radius: 8px;
                font-weight: 600;
                font-size: 14px;
                padding: 10px 16px;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 5px rgba(80, 70, 230, 0.2);
                transition: background 0.2s;
            }
            
            #openclaw-new-chat:hover {
                background: #4338ca;
            }

            .openclaw-history-list {
                flex: 1;
                overflow-y: auto;
                padding: 0 8px;
            }

            .openclaw-session-item,
            .openclaw-session-item:hover,
            .openclaw-session-item.active,
            .openclaw-session-item::before,
            .openclaw-session-item::after {
                border: none !important;
                border-left: none !important;
                outline: none !important;
                box-shadow: none !important;
            }

            .openclaw-session-item {
                padding: 10px 14px !important;
                margin-bottom: 4px !important;
                cursor: pointer !important;
                color: #4b5563 !important;
                font-size: 14px !important;
                border-radius: 8px !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                transition: all 0.2s ease !important;
            }

            .openclaw-session-item:hover {
                background: #ede9fe !important;
                color: #5046e6 !important;
            }

            .openclaw-session-item.active {
                background: #ede9fe !important;
                font-weight: 600 !important;
                color: #5046e6 !important;
            }

            .openclaw-chat-icon {
                flex-shrink: 0;
                stroke: currentColor;
            }

            .openclaw-session-title {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                flex: 1;
            }

            .openclaw-sidebar-footer {
                padding: 16px;
                border-top: 1px solid #e5e7eb;
                font-size: 13.5px;
                color: #64748b;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 8px;
                background: #f8f9fe;
                margin-top: auto;
            }

            .openclaw-status-dot {
                width: 9px;
                height: 9px;
                background: #10b981;
                border-radius: 50%;
                display: inline-block;
            }

            /* Chat Layout & Message Alignments */

            .openclaw-chat {
                flex: 1;
                display: flex;
                flex-direction: column;
                background: #ffffff;
            }

            .openclaw-messages {
                flex: 1 !important;
                min-height: 380px !important;
                max-height: 480px !important;
                overflow-y: auto !important;
                padding: 12px 16px !important;
                background: #ffffff !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 8px !important;
            }

            .openclaw-message {
                display: flex !important;
                align-items: flex-start !important;
                gap: 8px !important;
                font-size: 13.5px !important;
                line-height: 1.4 !important;
                word-wrap: break-word !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                margin: 0 !important;
                padding: 0 !important;
                width: 100% !important;
            }

            .openclaw-message-content {
                text-align: left !important;
                white-space: pre-wrap !important;
                word-break: break-word !important;
                width: fit-content !important;
                max-width: 100% !important;
                display: inline-block !important;
                box-sizing: border-box !important;
            }

            .openclaw-avatar {
                width: 26px !important;
                height: 26px !important;
                border-radius: 50% !important;
                background: #5046e6 !important;
                color: #ffffff !important;
                font-size: 10.5px !important;
                font-weight: 700 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex-shrink: 0 !important;
                margin-top: 2px !important;
            }

            /* User Message (First Text - Right Aligned Container) */
            .openclaw-user {
                align-self: flex-end !important;
                flex-direction: row-reverse !important;
                max-width: 75% !important;
                margin-left: auto !important;
                width: fit-content !important;
            }

            .openclaw-user .openclaw-message-content {
                background-color: #5046e6 !important;
                color: #ffffff !important;
                padding: 4px 8px !important;
                border-radius: 10px 10px 2px 10px !important;
                border: none !important;
                box-shadow: 0 1.5px 3px rgba(80, 70, 230, 0.15) !important;
                text-align: left !important;
                width: fit-content !important;
            }

            /* Bot Message (Second Text - Left Aligned Container) */
            .openclaw-bot {
                align-self: flex-start !important;
                max-width: 85% !important;
                margin-right: auto !important;
                width: fit-content !important;
            }

            .openclaw-bot .openclaw-message-content {
                background-color: #eff6ff !important;
                color: #0f172a !important;
                padding: 4px 8px !important;
                border: 1px solid #dbeafe !important;
                border-radius: 10px 10px 10px 2px !important;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03) !important;
                text-align: left !important;
                width: fit-content !important;
            }

            .openclaw-thinking {
                opacity: 0.7;
                font-style: italic;
            }

            .openclaw-input-area {
                display: flex;
                gap: 10px;
                padding: 16px 24px;
                border-top: 1px solid #e5e7eb;
                background: #ffffff;
                align-items: center;
            }

            #openclaw-question {
                flex: 1;
                height: 46px;
                font-size: 14px;
                background: #f1f5f9;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 10px 16px;
                color: #1e293b;
            }

            #openclaw-question:focus {
                background: #ffffff;
                border-color: #6366f1;
                box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
            }

            .openclaw-mic {
                width: 46px !important;
                height: 46px !important;
                background: #f1f5f9 !important;
                border: 1px solid #e2e8f0 !important;
                border-radius: 10px !important;
                display: flex !important;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }

            .openclaw-mic-svg {
                width: 18px;
                height: 18px;
                stroke: #64748b;
            }

            .openclaw-send {
                background: #0f172a !important;
                color: #ffffff !important;
                border: none !important;
                border-radius: 10px !important;
                height: 46px !important;
                padding: 0 24px !important;
                font-weight: 600 !important;
                font-size: 14px !important;
                transition: background 0.2s;
            }

            .openclaw-send:hover {
                background: #1e293b !important;
            }

            .modal-dialog.modal-xl {
                max-width: 950px;
            }

            .modal-footer .btn-primary {
                background: #0f172a !important;
                color: #ffffff !important;
                border-radius: 8px !important;
                border: none !important;
                font-weight: 600 !important;
                padding: 8px 20px !important;
            }

        </style>

    `);

};


/* =========================================================
   KEEP BUTTON AVAILABLE AFTER REPORT LOAD / REFRESH
   ========================================================= */

openclaw.start_button_watcher = function () {

    console.log(
        "OpenClaw: Starting button watcher"
    );


    if (
        openclaw.button_watcher
    ) {

        clearInterval(
            openclaw.button_watcher
        );

    }


    openclaw.button_watcher =
        setInterval(
            function () {

                if (openclaw.is_allowed_report()) {
                    console.log("OpenClaw: Watcher matched query-report route. Adding button...");
                    openclaw.add_profit_loss_button();
                }

            },
            2000
        );

};


/* =========================================================
   REPORT LOADED
   ========================================================= */

$(document).on(
    "report-loaded",
    function () {

        console.log(
            "OpenClaw: report-loaded"
        );


        setTimeout(
            function () {

                openclaw.add_profit_loss_button();

            },
            500
        );

    }
);


/* =========================================================
   PAGE LOAD
   ========================================================= */

$(document).ready(
    function () {

        openclaw.start_button_watcher();

    }
);


/* =========================================================
   AFTER AJAX
   ========================================================= */

frappe.after_ajax(
    function () {

        if (openclaw.is_allowed_report()) {
            openclaw.add_profit_loss_button();
        }

    }
);
