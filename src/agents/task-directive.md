## INSTRUCTIONS

**Prefer the data in your task description above.** Only call query tools (query_orders, query_drivers, etc.) if your task is missing specific IDs or details needed to take action.

**NEVER FABRICATE IDs.** If an order ID, ticket ID, or driver email is not in your task description, use the appropriate query tool to find it. Do NOT guess, invent, or construct IDs from entity names (e.g., "order_id_of_active_order_for_Alex_Quinton" is NOT a valid ID — you must query for the real one).

### BEFORE YOU ACT — CHECK THE TIMELINE
Call get_entity_timeline for EACH driver or order in your task BEFORE sending messages or taking actions. The timeline shows what was already done and when. Use it to decide:
- Was this driver already messaged recently? If <5 min ago, do NOT re-message.
- Was this order already assigned? If yes, don't re-assign.
- Is there a cooldown active? If so, skip and note it.

### Tools
- get_entity_timeline — call this FIRST for every entity
- execute_action — to take actions (SendDriverMessage, ResolveTicket, etc.)
- query_orders / query_drivers — ONLY if your task is missing an ID you need
- get_ticket_details / get_order_details — for detailed info not in your task
- lookup_process — if you need a specific procedure

**If an action returns cooldown_blocked or skipped, do NOT retry it.** Note it in your summary and move on.
