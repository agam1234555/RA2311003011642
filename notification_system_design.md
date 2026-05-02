# Notification System Design

## Stage 1

### REST API Design for Notification Platform

#### Core Endpoints

**Get all notifications for a user**
**Mark notification as read**
**Mark all as read**
**Delete notification**
**Real-time notifications**
---

## Stage 2

### Persistent Storage Design

**Recommended DB: PostgreSQL**

Reasons:
- Structured notification data fits relational model
- Supports complex queries (filter by type, date, read status)
- ACID compliance ensures no notification loss
- Scales well with indexing

**Schema:**

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL,
  type VARCHAR(20) CHECK (type IN ('placement', 'result', 'event')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  isRead BOOLEAN DEFAULT false,
  weight INT DEFAULT 0,
  createdAt TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_userId ON notifications(userId);
CREATE INDEX idx_notifications_isRead ON notifications(isRead);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_createdAt ON notifications(createdAt DESC);
```

**Problems at scale and solutions:**

| Problem | Solution |
|---|---|
| 5M+ rows slow queries | Partition table by userId or date range |
| Read heavy load | Add Redis cache for unread counts |
| Write spikes | Use message queue (BullMQ) for inserts |
| Old data | Archive notifications older than 90 days |

---

## Stage 3

### Query Analysis and Optimization

**Slow query:**
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Why it is slow:**
- `SELECT *` fetches all columns including large text fields
- No composite index on `(studentID, isRead, createdAt)`
- At 5M rows full table scan is expensive

**Is adding indexes on every column effective?**
No. Adding indexes on every column is bad advice because:
- Each index slows down INSERT/UPDATE operations
- Indexes consume disk space
- Query planner gets confused with too many indexes

**Fix — add only composite index:**
```sql
CREATE INDEX idx_student_unread ON notifications(studentID, isRead, createdAt DESC);
```

**Optimized query:**
```sql
SELECT id, title, message, createdAt 
FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC
LIMIT 50;
```

**Query to find students with placement notification in last 7 days:**
```sql
SELECT DISTINCT studentID 
FROM notifications
WHERE notificationType = 'Placement'
AND createdAt >= NOW() - INTERVAL '7 days';
```

---

## Stage 4

### Performance Optimization for DB Overload

**Problem:** Notifications fetched on every page load → DB overwhelmed.

**Solutions:**

**1. Redis Caching (Recommended)**
- Cache unread notifications per user with TTL 60 seconds
- On new notification → invalidate cache for that user
- Tradeoff: slight staleness (max 60s), massively reduced DB load

**2. Pagination**
- Never fetch all notifications at once
- Use cursor-based pagination: `GET /api/notifications?cursor=<lastId>&limit=20`
- Tradeoff: frontend needs to handle pagination logic

**3. WebSocket / SSE for real-time**
- Instead of polling on every page load, push new notifications via WebSocket
- Client maintains open connection, server pushes only new events
- Tradeoff: more complex infrastructure, need connection management

**4. Read replicas**
- Route all GET /notifications queries to read replica
- Primary DB handles only writes
- Tradeoff: replication lag, higher infra cost

**Best combined approach:** Redis cache + WebSocket push + pagination

---

## Stage 5

### Reliable Bulk Notification System

**Problem with current pseudocode:**
**Shortcomings:**
- Sequential loop — 50,000 emails sent one by one, very slow
- If `send_email` fails at student 200, remaining 49,800 never notified
- No retry mechanism
- Email + DB in same transaction — if DB fails after email sent, inconsistent state
- No observability — cannot tell which students got notified

**Should saving to DB and sending email happen together?**
No. They should be decoupled:
- Save to DB first (source of truth)
- Then trigger email asynchronously via queue
- If email fails, retry from queue without re-inserting to DB

**Revised design:**
notify_all(student_ids, message):

Batch insert all notifications to DB (bulk insert, single query)
Push all student_ids to Message Queue (BullMQ/RabbitMQ)

Email Worker (runs in parallel, N workers):

Pick student_id from queue
send_email(student_id, message)
On success → mark notification as emailSent=true in DB
On failure → retry up to 3 times with exponential backoff
After 3 failures → move to Dead Letter Queue → alert ops team

push_to_app:
Use WebSocket broadcast or FCM topic messaging for bulk push
**Revised pseudocode:**
function notify_all(student_ids, message):
bulk_insert_db(student_ids, message)
for batch in chunks(student_ids, 1000):
queue.push(batch, message)
function email_worker(batch, message):
for student_id in batch:
try:
send_email(student_id, message)
db.update(student_id, emailSent=true)
catch error:
queue.retry(student_id, attempt+1, backoff)
---

## Stage 6

### Priority Inbox — Top N Notifications

**Approach:**
Fetch notifications from API, score each by weight + recency, return top N.

**Priority weight:**
- placement → 3
- result → 2  
- event → 1

**Recency score:** newer notifications ranked higher within same weight.

**Final score = weight * 1000 + recencyScore**

**Code:** See `vehicle_scheduling/src/service/notificationService.js`

**How to maintain top 10 efficiently as new notifications arrive:**
Use a Min-Heap of size N:
- For each new notification compute score
- If score > heap minimum → replace minimum with new notification
- Heap always contains top N by score
- Time complexity: O(log N) per insertion vs O(M log M) for full sort