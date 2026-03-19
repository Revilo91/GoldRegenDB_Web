# GoldRegenDB Agent Skills

This document provides an overview of all available skills for agents working with the GoldRegenDB jewelry inventory management system.

## Skill Tree Overview

GoldRegenDB is a comprehensive web-based inventory management system for handcrafted jewelry. The system is built with PostgreSQL, Node.js/Express backend, and React frontend, all containerized with Docker.

### Core System Information

- **Database:** PostgreSQL 16 with triggers and audit logging
- **Backend:** Node.js 20 + Express.js (REST API, no ORM)
- **Frontend:** React 19 + Vite + React Router v7
- **Authentication:** JWT-based with role-based access control
- **Deployment:** Docker + Docker Compose

### User Roles

- **admin:** Full system access including user management, audit logs, debug tools, and backups
- **bearbeiter:** Access to all operational features (Dashboard, Kunden, Schmuckstücke, Lieferscheine, Rechnungen, SumUp, Inventur)
- **user:** Limited to creating Schmuckstücke only

## Available Skills

### 1. [Authentication & Authorization](./authentication.md)
**Purpose:** Handle user authentication, JWT tokens, and role-based access control

**Key Capabilities:**
- Login/logout operations
- JWT token management
- Password hashing (SHA-256 frontend, bcryptjs backend)
- Role-based access control (admin, bearbeiter, user)
- Rate limiting configuration

**When to Use:** Authentication flows, user session management, security implementations

---

### 2. [Inventory Management](./inventory-management.md)
**Purpose:** Manage jewelry items (Schmuckstücke) with 34+ attributes

**Key Capabilities:**
- CRUD operations for jewelry items
- Complex filtering using WHERE clause builder
- Artikelnummer prefix validation (Hersteller, Grundmaterial, Produktart)
- Status management (Verkauft, Ausschuss, Ausgelagert)
- Business logic enforcement (Verkauft ≠ Ausschuss)

**When to Use:** Working with jewelry inventory, implementing filters, status updates

---

### 3. [Customer Management](./customer-management.md)
**Purpose:** Manage customers/dealers and consignment tracking

**Key Capabilities:**
- Customer CRUD operations
- Consignment tracking (Ausgelagert)
- Restock operations (single/bulk)
- Commission management (Provision)
- Active/inactive customer status

**When to Use:** Customer data operations, consignment management, dealer relationships

---

### 4. [Document Generation](./document-generation.md)
**Purpose:** Generate delivery notes, invoices, and Excel reports

**Key Capabilities:**
- Delivery notes (Lieferschein) creation and management
- Invoice (Rechnung) creation and management
- Excel export with company branding
- Multiple export formats (inventory, customers, sales)
- Template-based document generation

**When to Use:** Creating documents, generating reports, Excel exports

---

### 5. [Data Synchronization](./data-sync.md)
**Purpose:** SumUp CSV integration for sales data

**Key Capabilities:**
- SumUp CSV import with automatic processing
- Automatic Lieferschein/Rechnung creation from sales
- Available items CSV export for SumUp
- Data validation and error handling
- Batch processing

**When to Use:** SumUp integration, sales data import, inventory sync

---

### 6. [Audit & Compliance](./audit-compliance.md)
**Purpose:** Track changes and maintain audit logs

**Key Capabilities:**
- Database trigger-based audit logging
- Change tracking for critical fields
- User attribution (changed_by via session config)
- Audit log querying and filtering
- Article-specific change history

**When to Use:** Compliance requirements, change tracking, audit investigations

---

### 7. [Backup & Recovery](./backup-recovery.md)
**Purpose:** Database backup and restoration operations

**Key Capabilities:**
- JSON-based database export
- Multi-format import support
- Schema-aware import (ignores missing columns)
- Batch processing for large datasets
- SERIAL sequence management
- Automated PostgreSQL dumps

**When to Use:** Data protection, migrations, disaster recovery

---

### 8. [Search & Filtering](./search-filtering.md)
**Purpose:** Complex multi-attribute search and filtering

**Key Capabilities:**
- WHERE clause builder (mandatory for Schmuckstück queries)
- Status-based filters (verfuegbar, verkauft, ausschuss, aktivAusgelagert)
- Prefix-based filtering (hersteller, grundmaterial, produktart)
- Attribute-based filtering (Art, Farbe, Material, etc.)
- Full-text search capabilities

**When to Use:** Implementing search features, query optimization, consistent filtering

---

### 9. [Photo Asset Management](./photo-management.md)
**Purpose:** Handle jewelry photo uploads and storage

**Key Capabilities:**
- Photo upload via multer (max 5 MB, jpg/png/gif)
- Drag & drop interface support
- Image validation with image-size
- Secure file storage
- Photo retrieval and deletion
- Preview generation

**When to Use:** Image handling, file uploads, asset management

---

### 10. [Reporting & Analytics](./reporting-analytics.md)
**Purpose:** Dashboard statistics and business intelligence

**Key Capabilities:**
- Inventory statistics (total, available, sold, consigned)
- Sales analytics (revenue, top sellers)
- Customer-specific reporting
- Inventory overview by customer
- Multi-dimensional analysis

**When to Use:** Dashboard features, business reporting, analytics

---

### 11. [Database Operations](./database-operations.md)
**Purpose:** PostgreSQL patterns, query building, and migrations

**Key Capabilities:**
- Request-scoped database clients (AsyncLocalStorage)
- Session user configuration for audit triggers
- Prepared statement patterns
- Migration execution at startup
- Connection pool management
- WHERE clause builder usage

**When to Use:** Database queries, migrations, data access patterns

---

### 12. [Testing & Quality](./testing.md)
**Purpose:** Test patterns and quality assurance

**Key Capabilities:**
- Jest testing for backend (Node environment)
- Vitest testing for frontend (browser environment)
- Mock patterns (db, logger, middleware)
- JWT_SECRET environment setup
- CI/CD integration (GitHub Actions)
- Test isolation and cleanup

**When to Use:** Writing tests, quality assurance, CI/CD setup

---

## Skill Dependencies

### High-Level Dependencies
```
Authentication & Authorization
    ↓
    ├─→ Inventory Management
    │       ↓
    │       ├─→ Search & Filtering (WHERE builder)
    │       ├─→ Photo Asset Management
    │       └─→ Audit & Compliance
    │
    ├─→ Customer Management
    │       ↓
    │       └─→ Audit & Compliance
    │
    ├─→ Document Generation
    │       ↓
    │       └─→ Reporting & Analytics
    │
    ├─→ Data Synchronization
    │       ↓
    │       ├─→ Inventory Management
    │       └─→ Document Generation
    │
    └─→ Backup & Recovery

Database Operations
    ↓
    └─→ All Skills (foundational)

Testing & Quality
    ↓
    └─→ All Skills (cross-cutting)
```

## Getting Started

1. **New to the system?** Start with [Database Operations](./database-operations.md) to understand data access patterns
2. **Working on features?** Check [Authentication](./authentication.md) first, then the relevant feature skill
3. **Need to filter data?** Always use [Search & Filtering](./search-filtering.md) for consistent business logic
4. **Testing changes?** Refer to [Testing & Quality](./testing.md) for test patterns

## Quick Reference

### Essential Files
- `/backend/src/utils/whereClauseBuilder.js` - **MANDATORY** for Schmuckstück filtering
- `/backend/src/middleware/auth.js` - Authentication and authorization
- `/backend/src/config/db.js` - Database connection and request-scoped clients
- `/backend/src/utils/logger.js` - Structured logging
- `/backend/src/utils/excelService.js` - Excel generation

### Key Documentation
- `/.github/copilot-instructions.md` - Comprehensive system documentation
- `/backend/src/utils/WHERE_BUILDER.md` - WHERE clause builder documentation
- `/db/README.md` - Backup and restore procedures

### Environment
- Development: `docker compose -f docker-compose.dev.yml up --build`
- Production: `docker compose up --build -d`
- Tests: `npm test` (in backend/ or frontend/)

## Contributing to Skills

When adding new skills or updating existing ones:

1. **Be Specific:** Include code examples and file paths
2. **Show Patterns:** Demonstrate the canonical way to implement features
3. **Link Dependencies:** Reference related skills and utilities
4. **Update This File:** Keep the skill tree overview current
5. **Test Examples:** Ensure code examples work in the current codebase

## Support

For questions about:
- **Architecture:** See `.github/copilot-instructions.md`
- **Database Schema:** See `db/init.sql` and ER diagram in copilot-instructions.md
- **API Endpoints:** See API section in copilot-instructions.md
- **Business Logic:** See WHERE_BUILDER.md and copilot-instructions.md
