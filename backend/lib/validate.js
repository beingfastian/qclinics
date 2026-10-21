// Request validation with zod schemas, shared by every module.
//
//   router.post("/things", validate(thingSchema), handler)          // req.body
//   router.get("/things", validate(listSchema, "query"), handler)    // req.query
//
// The parsed (trimmed, converted) value replaces the original, so handlers only see
// clean data. Invalid input gets HTTP 400 with one readable message and the fields:
//   { success: false, code: "invalid", message, fields: { name: "Required" } }
export const validate = (schema, where = "body") => (req, res, next) => {
  const result = schema.safeParse(req[where] ?? {});
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    const [firstField, firstMessage] = Object.entries(fields)[0] || ["_", "Invalid request"];
    return res.status(400).json({
      success: false,
      code: "invalid",
      message: firstField === "_" ? firstMessage : `${firstField}: ${firstMessage}`,
      fields,
    });
  }
  if (where === "query") {
    // req.query is a getter in Express 5; keep the parsed copy separately and in place
    req.validatedQuery = result.data;
  } else {
    req[where] = result.data;
  }
  next();
};
