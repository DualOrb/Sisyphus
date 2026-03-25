# Old Dispatch System Discovery (dispatch.valleyeats.ca)

**Date:** 2026-03-25
**Status:** Live production system — Sisyphus will integrate with this first.

---

## Quick Reference

| Aspect | Detail |
|--------|--------|
| **URL** | `dispatch.valleyeats.ca` |
| **Stack** | PHP 7.x + jQuery 3.3.1 + Bootstrap 3.3.7 + Google Maps |
| **Auth** | Cognito OAuth 2.0 (redirect flow, session-based) |
| **DB** | DynamoDB (direct) + DynaClone (MySQL read replica) |
| **WebSocket** | `wss://x1l8f4clhc.execute-api.us-east-1.amazonaws.com/prod/` |
| **API** | 422 PHP POST endpoints at `/post/*.php` |
| **Map** | Google Maps with real-time order/driver markers |
| **Routing** | URL params: `?view=dispatch&market=Pembroke` |
| **State** | localStorage + cookies + in-memory JS cache + PHP sessions |

---

## Key Endpoints for Sisyphus

### Read Operations
| Endpoint | Purpose | Params |
|----------|---------|--------|
| `POST /post/builddispatchcache.php` | Load all active orders + drivers | `{zone}` |
| `POST /post/getorder.php` | Get order details | `{OrderId}` |
| `POST /post/getadminorder.php` | Full admin order details | `{OrderId}` |
| `POST /post/getadmincustomer.php` | Customer details | `{email}` |
| `POST /post/getadmindriver.php` | Driver details | `{DriverId}` |
| `POST /post/buildissuerows.php` | List issues/tickets | `{zone, status}` |
| `POST /post/builddriverselect.php` | Driver dropdown options | `{zone}` |

### Write Operations
| Endpoint | Purpose | Params |
|----------|---------|--------|
| `POST /post/changeorderstatus.php` | Change order status | `{OrderId, status}` |
| `POST /post/changedriver.php` | Reassign driver | `{OrderId, DriverId, reason?}` |
| `POST /post/senddriverchat.php` | Message a driver | `{DriverId, message}` |
| `POST /post/bulkdriverchat.php` | Message multiple drivers | `{drivers[], message}` |
| `POST /post/addmessage.php` | Add message to ticket | `{IssueId, message}` |
| `POST /post/sendordernotification.php` | Notify customer about order | `{OrderId, message}` |

---

## DOM Selectors for Browser Automation

### Navigation
| Element | Selector |
|---------|----------|
| Market tabs | `#ClickTab{market}` (e.g., `#ClickTabPembroke`) |
| Market add button | — (need to verify) |
| View navigation | `#navReports`, `#navBill88`, etc. |

### Dispatch Page
| Element | Selector |
|---------|----------|
| Order table | `#deliveriestable{market}` |
| Order rows | `#deliveriestable{market} tbody tr` |
| Order count badge | `#orderCounter{market}` |
| Driver count | `#driverCounter{market}` |
| ETA display | `#{market}Eta` |
| Market gauge | `#gauge{market}` |
| Map container | `#mapContainer` |
| AI control button | `#ai-control-button` |

### Modals
| Element | Selector |
|---------|----------|
| Order modal | `#orderModal` |
| Order key lookup | `#orderKeyModal` |
| Customer modal | `#orderCustomerModal` |
| Customer search | `#customerSearch` |

### WebSocket
| Element | Selector |
|---------|----------|
| WS status button | `#websocketButton` |
| Cache display | `#cacheDisplay` |

---

## Authentication Flow

1. Sisyphus navigates to `dispatch.valleyeats.ca`
2. PHP checks `$_SESSION['access_token']` — if missing, redirects to Cognito
3. Cognito hosted UI at `valleyeats.auth.us-east-1.amazoncognito.com/login`
4. After login, redirects back with `?code=<AUTH_CODE>`
5. PHP exchanges code for tokens via `/post/getaccesstoken.php`
6. Session established — all `/post/*.php` calls authenticated via session cookie

**For Sisyphus:** After browser login, the PHP session cookie is set. All subsequent `/post/*.php` calls from the same browser session are authenticated. No Bearer token needed — session cookie handles it.

---

## Approach: API-First with Browser Fallback

Since the old dispatch uses simple POST endpoints with session auth, Sisyphus can:

1. **Login via browser** (Playwright) to establish the session cookie
2. **Call `/post/*.php` endpoints directly** using the session cookie — much faster and more reliable than clicking buttons
3. **Use browser only for visual presence** — keep the dispatch page open so humans see Sisyphus is "logged in"

This is BETTER than the original plan of clicking buttons because:
- PHP endpoints are stable (no CSS selectors to break)
- Faster execution (no DOM interaction delays)
- More reliable (no timing/animation issues)
- Still visible in the dispatch UI (logged in via browser, presence shown)

---

## Existing AI System

The old dispatch already has an AI system:
- Config at `/ai-system/config/ai-config.json`
- Shadow mode active
- Lambda: `valleyeats-ai-websocket-client-production`
- Max 5 actions/min, 85% confidence threshold
- Logs to `ValleyEats-AIDecisions-production` and `ValleyEats-AIMetrics-production`

Sisyphus will **replace** this system, not coexist with it.
