# Photo Asset Management Skill

## Overview

This skill covers handling jewelry photo uploads, storage, validation, and retrieval with drag-and-drop support and image optimization for the GoldRegenDB system.

## Core Concepts

### Upload Constraints

- **Maximum File Size:** 5 MB
- **Allowed Formats:** JPG, PNG, GIF
- **Storage Location:** `/backend/src/assets/uploads/`
- **Image Validation:** Image-size library verification
- **Naming Convention:** `{artikelnummer}.{extension}`

### Upload Process

1. Client-side validation (type, size)
2. Server-side multer processing
3. Image dimensions verification
4. File storage in assets directory
5. Database reference update (Foto column)
6. Thumbnail generation (optional)

## Key Files

- `/backend/src/middleware/multer.js` - Upload middleware configuration
- `/backend/src/routes/schmuckstuecke.js` - Photo upload endpoints
- `/frontend/src/components/PhotoUpload.jsx` - React upload component
- `/backend/src/assets/uploads/` - Photo storage directory

## Multer Configuration

### Middleware Setup

**File:** `/backend/src/middleware/multer.js`

```javascript
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../assets/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Use artikelnummer as filename with original extension
    const { artikelnummer } = req.params;
    const ext = path.extname(file.originalname);
    cb(null, `${artikelnummer}${ext}`);
  }
});

// Configure file filter
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif'];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, and GIF files are allowed'));
  }
};

// Create multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB
  }
});

module.exports = upload;
```

## Upload Endpoint

### POST /api/schmuckstuecke/:artikelnummer/foto

```javascript
const express = require('express');
const router = express.Router();
const multer = require('multer');
const sizeOf = require('image-size');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const upload = require('../middleware/multer');

// Upload photo
router.post('/:artikelnummer/foto', upload.single('file'), async (req, res) => {
  try {
    const { artikelnummer } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Validate image dimensions
    const dimensions = sizeOf(req.file.path);

    if (!dimensions.width || !dimensions.height) {
      // Delete invalid file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid image format' });
    }

    // Validate dimensions (reasonable for jewelry photos)
    if (dimensions.width < 100 || dimensions.height < 100) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'Image too small (minimum 100x100 pixels)'
      });
    }

    // Update database with photo filename
    await db.query(
      'UPDATE "Schmuckstück" SET "Foto" = $1 WHERE "Artikelnummer" = $2',
      [req.file.filename, artikelnummer]
    );

    logger.info('PHOTO', 'Photo uploaded', {
      artikelnummer,
      filename: req.file.filename,
      size: req.file.size,
      dimensions: `${dimensions.width}x${dimensions.height}`
    });

    res.json({
      success: true,
      path: req.file.filename,
      size: req.file.size,
      dimensions: { width: dimensions.width, height: dimensions.height }
    });

  } catch (error) {
    // Clean up on error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    logger.error('PHOTO', 'Upload failed', { message: error.message });
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
```

## Photo Retrieval

### GET /api/schmuckstuecke/foto/:filename

```javascript
router.get('/foto/:filename', (req, res) => {
  try {
    const { filename } = req.params;

    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(__dirname, '../assets/uploads', filename);

    // Verify file exists
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Send file with caching headers
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400'); // 24 hour cache
    res.sendFile(filepath);

  } catch (error) {
    logger.error('PHOTO', 'Retrieval failed', { message: error.message });
    res.status(500).json({ error: 'Failed to retrieve photo' });
  }
});
```

## Photo Deletion

### DELETE /api/schmuckstuecke/:artikelnummer/foto

```javascript
router.delete('/:artikelnummer/foto', authenticate, requireBearbeiter, async (req, res) => {
  try {
    const { artikelnummer } = req.params;

    // Get current photo filename
    const result = await db.query(
      'SELECT "Foto" FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [artikelnummer]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const filename = result.rows[0].Foto;

    if (!filename) {
      return res.status(400).json({ error: 'No photo to delete' });
    }

    // Delete file from filesystem
    const filepath = path.join(__dirname, '../assets/uploads', filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    // Clear database reference
    await db.query(
      'UPDATE "Schmuckstück" SET "Foto" = NULL WHERE "Artikelnummer" = $1',
      [artikelnummer]
    );

    logger.info('PHOTO', 'Photo deleted', { artikelnummer, filename });

    res.json({ success: true, message: 'Photo deleted' });

  } catch (error) {
    logger.error('PHOTO', 'Deletion failed', { message: error.message });
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});
```

## Frontend Component

### PhotoUpload.jsx

**File:** `/frontend/src/components/PhotoUpload.jsx`

```javascript
import { useState, useEffect } from 'react';
import { api } from '../api';

export default function PhotoUpload({ artikelnummer, onPhotoSelected, initialPhoto }) {
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Load initial photo if provided
  useEffect(() => {
    if (initialPhoto) {
      api.loadPhotoAsDataUrl(initialPhoto).then((dataUrl) => {
        if (dataUrl) {
          setPreview(dataUrl);
        }
      });
    }
  }, [initialPhoto]);

  // Handle file selection and validation
  const handleFile = async (file) => {
    if (!file) return;

    // Type validation
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
      setError('Only JPG, PNG, and GIF files are allowed');
      return;
    }

    // Size validation (5 MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File too large (max. 5 MB)');
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // Show preview immediately
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target.result);
      };
      reader.readAsDataURL(file);

      // Upload to server
      const result = await api.uploadFoto(file, artikelnummer);
      if (result.success || result.path) {
        onPhotoSelected(result.path);
      }
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  // File input handler
  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="photo-upload-container">
      <div
        className={`drop-zone ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {preview ? (
          <div className="preview">
            <img src={preview} alt="Preview" />
            <p className="upload-hint">Drag to replace or click to select new photo</p>
          </div>
        ) : (
          <div className="empty-state">
            <p>Drag photo here or click to select</p>
            <p className="size-hint">Max 5 MB (JPG, PNG, GIF)</p>
          </div>
        )}

        <input
          type="file"
          accept="image/jpeg,image/png,image/gif"
          onChange={handleFileInput}
          disabled={uploading}
          style={{ display: 'none' }}
          id="photo-input"
        />
      </div>

      <label htmlFor="photo-input" className="browse-button">
        {uploading ? 'Uploading...' : 'Browse Files'}
      </label>

      {error && <div className="error-message">{error}</div>}

      {uploading && <div className="loading">Uploading photo...</div>}
    </div>
  );
}
```

## API Integration

### Frontend API Utilities

**File:** `/frontend/src/api.js`

```javascript
// Upload photo
export async function uploadFoto(file, artikelnummer) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `/api/schmuckstuecke/${artikelnummer}/foto`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

// Load photo as data URL (for preview)
export async function loadPhotoAsDataUrl(filename) {
  try {
    const response = await fetch(`/api/schmuckstuecke/foto/${filename}`);

    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to load photo:', error);
    return null;
  }
}

// Delete photo
export async function deleteFoto(artikelnummer) {
  const response = await fetch(
    `/api/schmuckstuecke/${artikelnummer}/foto`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Deletion failed');
  }

  return response.json();
}
```

## Storage Management

### Directory Structure

```
backend/
├── src/
│   ├── assets/
│   │   └── uploads/
│   │       ├── MBH001.jpg
│   │       ├── MPA425_2.png
│   │       └── ...
│   └── middleware/
│       └── multer.js
└── docker-compose.yml
```

### Docker Volume Configuration

**In `docker-compose.yml`:**

```yaml
services:
  backend:
    image: node:20
    volumes:
      - ./backend/src/assets/uploads:/app/backend/src/assets/uploads
      - ./backups:/backups
```

### Cleanup Expired Photos

```javascript
// Scheduled job to remove photos for deleted items
async function cleanupOrphanedPhotos() {
  const uploadsDir = path.join(__dirname, '../assets/uploads');
  const files = fs.readdirSync(uploadsDir);

  for (const filename of files) {
    // Extract artikelnummer from filename
    const artikelnummer = filename.split('.')[0];

    // Check if item still exists
    const result = await db.query(
      'SELECT "Artikelnummer" FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [artikelnummer]
    );

    if (result.rows.length === 0) {
      // Item deleted, remove photo
      fs.unlinkSync(path.join(uploadsDir, filename));
      logger.info('PHOTO', 'Orphaned photo deleted', { filename });
    }
  }
}
```

## Frontend Usage Example

### In Schmuckstück Form

```javascript
// frontend/src/pages/SchmuckstuckForm.jsx
import PhotoUpload from '../components/PhotoUpload';

export default function SchmuckstuckForm({ item }) {
  const [data, setData] = useState(item || {});

  const handlePhotoSelected = (photoPath) => {
    setData(prev => ({ ...prev, Foto: photoPath }));
  };

  return (
    <form>
      <input
        type="text"
        placeholder="Name"
        value={data.Name}
        onChange={(e) => setData(prev => ({ ...prev, Name: e.target.value }))}
      />

      <PhotoUpload
        artikelnummer={data.Artikelnummer}
        onPhotoSelected={handlePhotoSelected}
        initialPhoto={data.Foto}
      />

      <button type="submit">Save</button>
    </form>
  );
}
```

## Related Skills

- [Inventory Management](./inventory-management.md) - Photo reference in Schmuckstück
- [Database Operations](./database-operations.md) - Photo metadata storage
- [Testing & Quality](./testing.md) - Testing file uploads

## Troubleshooting

### Upload Fails with "File Too Large"

**Cause:** File exceeds 5 MB limit
**Solution:**
1. Compress image before upload
2. Verify file size: `ls -lh filename.jpg`
3. Use online image compressor
4. Increase limit in multer if needed (not recommended)

### "Invalid Image Format" Error

**Cause:** Image validation failed
**Solution:**
1. Ensure file is actual image (not renamed)
2. Check dimensions are at least 100x100
3. Use supported format (JPG, PNG, GIF)
4. Verify image-size library can read it: `identify filename.jpg`

### Photo Not Showing in UI

**Cause:** Incorrect file path or CORS issue
**Solution:**
1. Verify filename stored in database
2. Check file exists: `ls backend/src/assets/uploads/`
3. Verify API endpoint returns file
4. Check browser console for 404 errors
5. Clear browser cache

### Permission Denied on Upload

**Cause:** Insufficient write permissions on uploads directory
**Solution:**
1. Check directory permissions: `ls -ld backend/src/assets/uploads/`
2. Fix permissions: `chmod 755 backend/src/assets/uploads/`
3. Verify Docker volume mount
4. Check container user permissions

### Disk Space Issue

**Cause:** Uploads directory growing too large
**Solution:**
1. Monitor directory size: `du -sh backend/src/assets/uploads/`
2. Archive old photos: `find . -mtime +180 -move archive/`
3. Implement photo cleanup script
4. Use cloud storage (S3, Azure Blob) for large scale

### Memory Issue on Large Upload

**Cause:** Node running out of memory
**Solution:**
1. Increase Node memory: `NODE_OPTIONS=--max-old-space-size=4096`
2. Stream processing instead of buffering
3. Implement multi-part upload for large files
