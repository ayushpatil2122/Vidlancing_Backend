import { PrismaClient } from "@prisma/client";
import sanitizeHtml from "sanitize-html";
import { v4 as uuidv4 } from "uuid";
import {ApiResponse} from "../Utils/ApiResponse.js";
import fs from "fs/promises"; // For file deletion
import path from "path";

const prisma = new PrismaClient();

// Validation rules (aligned with schema enums)
const validCategories = ["TECHNICAL", "BILLING", "ACCOUNT", "FEATURE", "OTHER"];
const validPriorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const validContactMethods = ["EMAIL", "PHONE", "ANY"];
const validStatuses = ["PENDING", "IN_PROGRESS", "RESOLVED", "CLOSED"];

// Validate form data for creation
const validateFormData = (data) => {
  const errors = [];

  if (!data.firstName?.trim()) errors.push("First name is required");
  if (!data.lastName?.trim()) errors.push("Last name is required");
  if (!data.email?.trim()) errors.push("Email is required");
  if (!data.subject?.trim()) errors.push("Subject is required");
  if (!data.message?.trim()) errors.push("Message is required");

  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) {
    errors.push("Invalid email format");
  }

  if (data.category && !validCategories.includes(data.category)) {
    errors.push(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
  }
  if (data.priority && !validPriorities.includes(data.priority)) {
    errors.push(`Invalid priority. Must be one of: ${validPriorities.join(", ")}`);
  }
  if (data.contactMethod && !validContactMethods.includes(data.contactMethod)) {
    errors.push(`Invalid contact method. Must be one of: ${validContactMethods.join(", ")}`);
  }

  if (data.phone && !/^\+?[\d\s-]{7,15}$/.test(data.phone)) {
    errors.push("Invalid phone number format");
  }

  return errors;
};

// Validate update data
const validateUpdateData = (data) => {
  const errors = [];

  if (data.status && !validStatuses.includes(data.status)) {
    errors.push(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }
  if (data.isResolved !== undefined && typeof data.isResolved !== "boolean") {
    errors.push("isResolved must be a boolean");
  }
  if (data.resolutionNotes && typeof data.resolutionNotes !== "string") {
    errors.push("resolutionNotes must be a string");
  }
  if (data.assignedAdminId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.assignedAdminId)) {
    errors.push("Invalid admin ID format");
  }

  return errors;
};

// Sanitize input data
const sanitizeInput = (data) => ({
  firstName: sanitizeHtml(data.firstName?.trim() || ""),
  lastName: sanitizeHtml(data.lastName?.trim() || ""),
  email: sanitizeHtml(data.email?.trim() || ""),
  phone: data.phone ? sanitizeHtml(data.phone.trim()) : null,
  category: sanitizeHtml(data.category?.trim() || "OTHER"),
  subject: sanitizeHtml(data.subject?.trim() || ""),
  message: sanitizeHtml(data.message?.trim() || "", {
    allowedTags: [],
    allowedAttributes: {},
  }),
  priority: sanitizeHtml(data.priority?.trim() || "MEDIUM"),
  contactMethod: sanitizeHtml(data.contactMethod?.trim() || "EMAIL"),
  description: data.description ? sanitizeHtml(data.description.trim()) : null,
  status: data.status ? sanitizeHtml(data.status.trim()) : undefined,
  isResolved: data.isResolved !== undefined ? Boolean(data.isResolved) : undefined,
  resolutionNotes: data.resolutionNotes ? sanitizeHtml(data.resolutionNotes.trim(), { allowedTags: [] }) : undefined,
  assignedAdminId: data.assignedAdminId ? sanitizeHtml(data.assignedAdminId.trim()) : undefined,
  note: data.note ? sanitizeHtml(data.note.trim(), { allowedTags: [] }) : undefined,
});

// POST /api/v1/contact
export const createContactSubmission = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Processing contact submission`);

  try {
    const { body, files = [] } = req;
    console.log(`[${requestId}] Received body:`, JSON.stringify(body));
    console.log(`[${requestId}] Received files:`, files.map((f) => f.originalname));

    // Sanitize inputs
    const sanitizedData = sanitizeInput(body);
    console.log(`[${requestId}] Sanitized data:`, JSON.stringify(sanitizedData));

    // Validate form data
    const validationErrors = validateFormData(sanitizedData);
    if (validationErrors.length > 0) {
      console.warn(`[${requestId}] Validation errors:`, validationErrors);
      return res.status(400).json(
        new ApiResponse(400, { errors: validationErrors }, "Validation failed")
      );
    }

    // Create contact submission
    console.log(`[${requestId}] Creating contact submission in database`);
    const contactSubmission = await prisma.contactSubmission.create({
      data: {
        firstName: sanitizedData.firstName,
        lastName: sanitizedData.lastName,
        email: sanitizedData.email,
        phone: sanitizedData.phone,
        category: sanitizedData.category,
        subject: sanitizedData.subject,
        message: sanitizedData.message,
        priority: sanitizedData.priority,
        contactMethod: sanitizedData.contactMethod,
        status: "PENDING",
        isResolved: false,
        lastActionAt: new Date(),
        createdBy: req.user?.id || null, // Include if auth is enabled
      },
    });
    console.log(`[${requestId}] Created submission ID: ${contactSubmission.id}`);

    // Handle file uploads
    let fileRecords = [];
    if (files.length > 0) {
      console.log(`[${requestId}] Processing ${files.length} file(s)`);
      fileRecords = await Promise.all(
        files.map(async (file) => {
          try {
            const fileRecord = await prisma.contactFile.create({
              data: {
                contactSubmissionId: contactSubmission.id,
                fileName: file.originalname,
                fileUrl: `/uploads/contact/${file.filename}`,
                fileType: file.mimetype,
                fileSize: file.size,
                description: sanitizedData.description || null,
              },
            });
            console.log(`[${requestId}] Created file record for ${file.filename}`);
            return fileRecord;
          } catch (fileError) {
            console.error(`[${requestId}] Error saving file ${file.filename}:`, fileError);
            throw new Error(`Failed to save file: ${file.filename}`);
          }
        })
      );
    }

    console.log(`[${requestId}] Contact submission processed successfully`);
    return res.status(201).json(
      new ApiResponse(
        201,
        { contactSubmission, files: fileRecords },
        "Contact submission created successfully"
      )
    );
  } catch (error) {
    console.error(`[${requestId}] Error in createContactSubmission:`, {
      message: error.message,
      stack: error.stack,
      requestBody: req.body,
      requestFiles: (req.files || []).map((f) => f.originalname),
    });

    if (error.name === "PrismaClientKnownRequestError") {
      return res.status(500).json(
        new ApiResponse(500, null, "Database error: Failed to save submission")
      );
    }

    if (error.message.includes("Failed to save file")) {
      return res.status(500).json(
        new ApiResponse(500, null, "Error processing uploaded files")
      );
    }

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// GET /api/v1/contact
export const getContactSubmissions = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Fetching contact submissions`);

  try {
    const {
      status,
      priority,
      category,
      isResolved,
      email,
      page = 1,
      limit = 20,
      sort,
    } = req.query;

    const where = {
      ...(status && { status }),
      ...(priority && { priority }),
      ...(category && { category }),
      ...(isResolved && { isResolved: isResolved === "true" }),
      ...(email && { email: { contains: email, mode: "insensitive" } }),
    };

    const orderBy = sort
      ? { [sort.replace("-", "")]: sort.startsWith("-") ? "desc" : "asc" }
      : { createdAt: "desc" };

    console.log(`[${requestId}] Query:`, { where, orderBy, page, limit });

    const [submissions, total] = await Promise.all([
      prisma.contactSubmission.findMany({
        where,
        orderBy,
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          subject: true,
          category: true,
          priority: true,
          status: true,
          isResolved: true,
          assignedAdminId: true,
          createdAt: true,
          lastActionAt: true,
          _count: { select: { files: true } },
        },
      }),
      prisma.contactSubmission.count({ where }),
    ]);

    console.log(`[${requestId}] Retrieved ${submissions.length} submissions, total: ${total}`);
    return res.status(200).json(
      new ApiResponse(
        200,
        { submissions, total, page: Number(page), limit: Number(limit) },
        "Submissions retrieved successfully"
      )
    );
  } catch (error) {
    console.error(`[${requestId}] Error in getContactSubmissions:`, {
      message: error.message,
      stack: error.stack,
      query: req.query,
    });

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// GET /api/v1/contact/:id
export const getContactSubmissionById = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Fetching contact submission: ${req.params.id}`);

  try {
    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id },
      include: { files: true },
    });

    if (!submission) {
      console.warn(`[${requestId}] Submission not found: ${req.params.id}`);
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    console.log(`[${requestId}] Retrieved submission: ${submission.id}`);
    return res.status(200).json(
      new ApiResponse(200, { submission }, "Submission retrieved successfully")
    );
  } catch (error) {
    console.error(`[${requestId}] Error in getContactSubmissionById:`, {
      message: error.message,
      stack: error.stack,
      submissionId: req.params.id,
    });

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// PATCH /api/v1/contact/:id
export const updateContactSubmission = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Updating contact submission: ${req.params.id}`);

  try {
    const sanitizedData = sanitizeInput(req.body);
    console.log(`[${requestId}] Sanitized update data:`, JSON.stringify(sanitizedData));

    const validationErrors = validateUpdateData(sanitizedData);
    if (validationErrors.length > 0) {
      console.warn(`[${requestId}] Validation errors:`, validationErrors);
      return res.status(400).json(
        new ApiResponse(400, { errors: validationErrors }, "Validation failed")
      );
    }

    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id },
    });

    if (!submission) {
      console.warn(`[${requestId}] Submission not found: ${req.params.id}`);
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    const updatedSubmission = await prisma.contactSubmission.update({
      where: { id: req.params.id },
      data: {
        status: sanitizedData.status,
        isResolved: sanitizedData.isResolved,
        resolutionNotes: sanitizedData.resolutionNotes,
        lastActionAt: new Date(),
        updatedBy: req.user?.id || null,
      },
      include: { files: true },
    });

    console.log(`[${requestId}] Updated submission: ${updatedSubmission.id}`);
    return res.status(200).json(
      new ApiResponse(
        200,
        { submission: updatedSubmission },
        "Submission updated successfully"
      )
    );
  } catch (error) {
    console.error(`[${requestId}] Error in updateContactSubmission:`, {
      message: error.message,
      stack: error.stack,
      submissionId: req.params.id,
      updateData: req.body,
    });

    if (error.name === "PrismaClientKnownRequestError" && error.code === "P2025") {
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// DELETE /api/v1/contact/:id
export const deleteContactSubmission = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Deleting contact submission: ${req.params.id}`);

  try {
    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id },
      include: { files: true },
    });

    if (!submission) {
      console.warn(`[${requestId}] Submission not found: ${req.params.id}`);
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    // Delete physical files
    for (const file of submission.files) {
      const filePath = path.join(process.env.UPLOAD_DIR || "./uploads/contact", path.basename(file.fileUrl));
      try {
        await fs.unlink(filePath);
        console.log(`[${requestId}] Deleted file: ${filePath}`);
      } catch (fileError) {
        console.warn(`[${requestId}] Failed to delete file ${filePath}:`, fileError);
      }
    }

    await prisma.contactSubmission.delete({
      where: { id: req.params.id },
    });

    console.log(`[${requestId}] Deleted submission: ${req.params.id}`);
    return res.status(204).json(
      new ApiResponse(204, null, "Submission deleted successfully")
    );
  } catch (error) {
    console.error(`[${requestId}] Error in deleteContactSubmission:`, {
      message: error.message,
      stack: error.stack,
      submissionId: req.params.id,
    });

    if (error.name === "PrismaClientKnownRequestError" && error.code === "P2025") {
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// PATCH /api/v1/contact/:id/assign
export const assignAdminToSubmission = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Assigning admin to submission: ${req.params.id}`);

  try {
    const { adminId } = req.body;
    const sanitizedData = sanitizeInput({ assignedAdminId: adminId });
    console.log(`[${requestId}] Sanitized admin ID:`, sanitizedData.assignedAdminId);

    if (!sanitizedData.assignedAdminId) {
      console.warn(`[${requestId}] Admin ID is required`);
      return res.status(400).json(
        new ApiResponse(400, null, "Admin ID is required")
      );
    }

    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id },
    });

    if (!submission) {
      console.warn(`[${requestId}] Submission not found: ${req.params.id}`);
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    // Optional: Verify adminId exists in an Admin model
    // const admin = await prisma.admin.findUnique({ where: { id: sanitizedData.assignedAdminId } });
    // if (!admin) {
    //   return res.status(404).json(new ApiResponse(404, null, "Admin not found"));
    // }

    const updatedSubmission = await prisma.contactSubmission.update({
      where: { id: req.params.id },
      data: {
        assignedAdminId: sanitizedData.assignedAdminId,
        status: submission.status === "PENDING" ? "IN_PROGRESS" : submission.status,
        lastActionAt: new Date(),
        updatedBy: req.user?.id || null,
      },
      include: { files: true },
    });

    console.log(`[${requestId}] Assigned admin to submission: ${updatedSubmission.id}`);
    return res.status(200).json(
      new ApiResponse(
        200,
        { submission: updatedSubmission },
        "Admin assigned successfully"
      )
    );
  } catch (error) {
    console.error(`[${requestId}] Error in assignAdminToSubmission:`, {
      message: error.message,
      stack: error.stack,
      submissionId: req.params.id,
      adminId: req.body.adminId,
    });

    if (error.name === "PrismaClientKnownRequestError" && error.code === "P2025") {
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// POST /api/v1/contact/:id/notes
export const addResolutionNote = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Adding note to submission: ${req.params.id}`);

  try {
    const { note } = req.body;
    const sanitizedData = sanitizeInput({ note });
    console.log(`[${requestId}] Sanitized note:`, sanitizedData.note);

    if (!sanitizedData.note) {
      console.warn(`[${requestId}] Note is required`);
      return res.status(400).json(
        new ApiResponse(400, null, "Note is required")
      );
    }

    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id },
    });

    if (!submission) {
      console.warn(`[${requestId}] Submission not found: ${req.params.id}`);
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    const updatedSubmission = await prisma.contactSubmission.update({
      where: { id: req.params.id },
      data: {
        resolutionNotes: submission.resolutionNotes
          ? `${submission.resolutionNotes}\n${new Date().toISOString()}: ${sanitizedData.note}`
          : `${new Date().toISOString()}: ${sanitizedData.note}`,
        lastActionAt: new Date(),
        updatedBy: req.user?.id || null,
      },
      include: { files: true },
    });

    console.log(`[${requestId}] Added note to submission: ${updatedSubmission.id}`);
    return res.status(200).json(
      new ApiResponse(
        200,
        { submission: updatedSubmission },
        "Note added successfully"
      )
    );
  } catch (error) {
    console.error(`[${requestId}] Error in addResolutionNote:`, {
      message: error.message,
      stack: error.stack,
      submissionId: req.params.id,
      note: req.body.note,
    });

    if (error.name === "PrismaClientKnownRequestError" && error.code === "P2025") {
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// GET /api/v1/contact/:id/files
export const getSubmissionFiles = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Fetching files for submission: ${req.params.id}`);

  try {
    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });

    if (!submission) {
      console.warn(`[${requestId}] Submission not found: ${req.params.id}`);
      return res.status(404).json(
        new ApiResponse(404, null, "Submission not found")
      );
    }

    const files = await prisma.contactFile.findMany({
      where: { contactSubmissionId: req.params.id },
    });

    console.log(`[${requestId}] Retrieved ${files.length} files for submission: ${req.params.id}`);
    return res.status(200).json(
      new ApiResponse(200, { files }, "Files retrieved successfully")
    );
  } catch (error) {
    console.error(`[${requestId}] Error in getSubmissionFiles:`, {
      message: error.message,
      stack: error.stack,
      submissionId: req.params.id,
    });

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};

// DELETE /api/v1/contact/:id/files/:fileId
export const deleteSubmissionFile = async (req, res) => {
  const requestId = uuidv4();
  console.log(`[${requestId}] Deleting file ${req.params.fileId} for submission: ${req.params.id}`);

  try {
    const file = await prisma.contactFile.findUnique({
      where: { id: req.params.fileId, contactSubmissionId: req.params.id },
    });

    if (!file) {
      console.warn(`[${requestId}] File not found: ${req.params.fileId}`);
      return res.status(404).json(
        new ApiResponse(404, null, "File not found")
      );
    }

    // Delete physical file
    const filePath = path.join(process.env.UPLOAD_DIR || "./uploads/contact", path.basename(file.fileUrl));
    try {
      await fs.unlink(filePath);
      console.log(`[${requestId}] Deleted file: ${filePath}`);
    } catch (fileError) {
      console.warn(`[${requestId}] Failed to delete file ${filePath}:`, fileError);
    }

    await prisma.contactFile.delete({
      where: { id: req.params.fileId },
    });

    // Update submission's lastActionAt
    await prisma.contactSubmission.update({
      where: { id: req.params.id },
      data: {
        lastActionAt: new Date(),
        updatedBy: req.user?.id || null,
      },
    });

    console.log(`[${requestId}] Deleted file: ${req.params.fileId}`);
    return res.status(204).json(
      new ApiResponse(204, null, "File deleted successfully")
    );
  } catch (error) {
    console.error(`[${requestId}] Error in deleteSubmissionFile:`, {
      message: error.message,
      stack: error.stack,
      submissionId: req.params.id,
      fileId: req.params.fileId,
    });

    if (error.name === "PrismaClientKnownRequestError" && error.code === "P2025") {
      return res.status(404).json(
        new ApiResponse(404, null, "File or submission not found")
      );
    }

    return res.status(500).json(
      new ApiResponse(500, null, "Internal server error")
    );
  } finally {
    await prisma.$disconnect();
    console.log(`[${requestId}] Prisma client disconnected`);
  }
};