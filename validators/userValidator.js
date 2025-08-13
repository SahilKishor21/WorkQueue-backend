const Joi = require('joi');

// User Registration Validation
const registerValidation = (data) => {
    const schema = Joi.object({
        name: Joi.string().min(3).max(30).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(6).required(),
        label: Joi.string().optional(), 
        username: Joi.string().required(),
        role: Joi.string().valid('User', 'Admin').required(),
    });
    return schema.validate(data);
};

// User Login Validation
const loginValidation = (data) => {
    const schema = Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(6).required()
    });
    return schema.validate(data);
};

// Assignment Upload Validation
const uploadAssignmentValidation = (data) => {
    const schema = Joi.object({
        title: Joi.string().min(3).required(), 
        adminId: Joi.string().required(), 
      /*  file: Joi.object({
            originalname: Joi.string().required(), 
            mimetype: Joi.string()
                .valid('application/pdf', 'application/vnd.ms-powerpoint', 'text/csv')
                .required(), 
            size: Joi.number().max(5 * 1024 * 1024).required()           
        }).required()  */
    });

    return schema.validate(data);
};

module.exports = {
    registerValidation,
    loginValidation,
    uploadAssignmentValidation
};
