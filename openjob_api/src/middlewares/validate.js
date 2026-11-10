const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(400).json({
        status: "failed",
        message: error.details[0].message,
      });
    }

    req.validatedBody = value;

    return next();
  };
};

module.exports = validate;
