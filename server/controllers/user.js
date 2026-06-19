import User from '../models/user.js'
import Lead from '../models/lead.js'
import { createError } from '../utils/error.js'
import bcrypt from 'bcryptjs'
import validator from 'validator'


const editableUserFields = ['firstName', 'lastName', 'username', 'phone', 'city', 'CNIC', 'email']
const requiredClientFields = ['firstName', 'lastName', 'username', 'phone']
const requiredEmployeeFields = [...requiredClientFields, 'password']

const trimString = (value) => typeof value === 'string' ? value.trim() : value

const buildUserPayload = (body, fields) => {
    return fields.reduce((payload, field) => {
        if (body[field] !== undefined) {
            payload[field] = trimString(body[field])
        }
        return payload
    }, {})
}

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== ''

const validateRequiredFields = (body, fields) => {
    const missingField = fields.find(field => !hasValue(body[field]))
    if (missingField) return `${missingField} is required`

    return null
}

const validateUserFields = (payload, requiredFields = []) => {
    const missingError = validateRequiredFields(payload, requiredFields)
    if (missingError) return missingError

    const emptyRequiredField = requiredClientFields.find(field => payload[field] !== undefined && !hasValue(payload[field]))
    if (emptyRequiredField) return `${emptyRequiredField} cannot be empty`

    if (payload.username !== undefined && !validator.isLength(String(payload.username), { min: 3, max: 30 })) {
        return 'Username must be between 3 and 30 characters'
    }

    if (payload.password !== undefined && !validator.isLength(String(payload.password), { min: 6 })) {
        return 'Password must be at least 6 characters long'
    }

    if (payload.phone !== undefined) {
        const phone = String(payload.phone)
        if (!validator.isLength(phone, { min: 7, max: 20 }) || !validator.matches(phone, /^[+()\-\s\d]+$/)) {
            return 'Invalid phone number'
        }
    }

    if (payload.email && !validator.isEmail(payload.email)) {
        return 'Invalid Email Address'
    }

    return null
}

const findDuplicateUser = async ({ username, email, phone }, excludedUserId = null) => {
    const duplicateConditions = []

    if (username) duplicateConditions.push({ username })
    if (email) duplicateConditions.push({ email })
    if (phone) duplicateConditions.push({ phone })

    if (duplicateConditions.length === 0) return null

    const query = { $or: duplicateConditions }
    if (excludedUserId) query._id = { $ne: excludedUserId }

    return User.findOne(query)
}

const getDuplicateMessage = (duplicateUser, payload) => {
    if (!duplicateUser) return null
    if (payload.username && duplicateUser.username === payload.username) return 'Username already exist'
    if (payload.email && duplicateUser.email === payload.email) return 'Email already exist'
    if (payload.phone && duplicateUser.phone === payload.phone) return 'Phone already exist'

    return 'User already exist'
}

export const getUsers = async (req, res, next) => {
    try {

        const users = await User.find()
        res.status(200).json({ result: users, message: 'users fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))

    }
}

export const getUser = async (req, res, next) => {
    try {

        const { userId } = req.params
        if (!validator.isMongoId(userId)) return next(createError(400, 'Invalid user id'))

        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(401, 'User not exist'))

        res.status(200).json({ result: findedUser, message: 'user fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))

    }
}

export const filterUser = async (req, res, next) => {
    const { startingDate, endingDate, ...filters } = req.query;
    try {
        let query = await User.find(filters)

        // Check if startingDate is provided and valid
        if (startingDate && isValidDate(startingDate)) {
            const startDate = new Date(startingDate);
            startDate.setHours(0, 0, 0, 0);

            // Add createdAt filtering for startingDate
            query = query.where('createdAt').gte(startDate);
        }

        // Check if endingDate is provided and valid
        if (endingDate && isValidDate(endingDate)) {
            const endDate = new Date(endingDate);
            endDate.setHours(23, 59, 59, 999);

            // Add createdAt filtering for endingDate
            if (query.model.modelName === 'User') { // Check if the query has not been executed yet
                query = query.where('createdAt').lte(endDate);
            }
        }
        if (query.length > 0) {
            query = await query.populate('userId').exec();
        }
        res.status(200).json({ result: query });

    } catch (error) {
        next(createError(500, error.message));
    }
};


export const getClients = async (req, res, next) => {
    try {

        const findedClients = await User.find({ role: 'client' })
        res.status(200).json({ result: findedClients, message: 'clients fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))

    }
}

export const getEmployeeClients = async (req, res, next) => {
    try {
        let allClients = await User.find({ role: 'client' })
        const employeeLeads = await Lead.find({ allocatedTo: { $in: req.user?._id }, isArchived: false })

        // Filter clients based on the condition
        allClients = allClients.filter((client) => {
            return employeeLeads.findIndex(lead => lead.clientPhone.toString() === client.phone.toString()) !== -1
        });

        res.status(200).json({ result: allClients, message: 'clients fetched successfully', success: true });
    } catch (err) {
        next(createError(500, err.message));
    }
};

export const getEmployees = async (req, res, next) => {
    try {

        const findedEmployees = await User.find({ role: 'employee' })
        res.status(200).json({ result: findedEmployees, message: 'employees fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const createClient = async (req, res, next) => {
    try {

        const payload = buildUserPayload(req.body, editableUserFields)
        const validationError = validateUserFields(payload, requiredClientFields)
        if (validationError) return next(createError(400, validationError))

        const findedUser = await findDuplicateUser(payload)
        const duplicateMessage = getDuplicateMessage(findedUser, payload)
        if (duplicateMessage) return next(createError(400, duplicateMessage))

        const result = await User.create({ ...payload, role: 'client' })
        res.status(200).json({ result, message: 'client created seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}
export const createEmployee = async (req, res, next) => {
    try {

        const payload = buildUserPayload(req.body, [...editableUserFields, 'password'])
        const validationError = validateUserFields(payload, requiredEmployeeFields)
        if (validationError) return next(createError(400, validationError))

        const findedUser = await findDuplicateUser(payload)
        const duplicateMessage = getDuplicateMessage(findedUser, payload)
        if (duplicateMessage) return next(createError(400, duplicateMessage))

        const hashedPassword = await bcrypt.hash(payload.password, 12)
        const { password, ...employeePayload } = payload

        const result = await User.create({ ...employeePayload, password: hashedPassword, role: 'employee' })
        res.status(200).json({ result, message: 'employee created seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const updateUser = async (req, res, next) => {
    try {

        const { userId } = req.params
        if (!validator.isMongoId(userId)) return next(createError(400, 'Invalid user id'))

        const payload = buildUserPayload(req.body, editableUserFields)
        if (Object.keys(payload).length === 0) return next(createError(400, 'No valid user fields provided'))

        const validationError = validateUserFields(payload)
        if (validationError) return next(createError(400, validationError))

        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(401, 'User not exist'))

        const duplicateUser = await findDuplicateUser(payload, userId)
        const duplicateMessage = getDuplicateMessage(duplicateUser, payload)
        if (duplicateMessage) return next(createError(400, duplicateMessage))

        const updatedUser = await User.findByIdAndUpdate(userId, { $set: payload }, { new: true, runValidators: true })
        res.status(200).json({ result: updatedUser, message: 'User updated successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const updateRole = async (req, res, next) => {
    try {

        const { userId } = req.params
        const { role } = req.body

        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(401, 'User not exist'))

        const updatedUser = await User.findByIdAndUpdate(userId, { role }, { new: true })
        res.status(200).json({ reuslt: updatedUser, message: 'Role updated successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const deleteUser = async (req, res, next) => {
    try {
        const { userId } = req.params
        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(400, 'User not exist'))

        const deletedUser = await User.findByIdAndDelete(userId)
        res.status(200).json({ result: deletedUser, message: 'User deleted successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const deleteWholeCollection = async (req, res, next) => {
    try {

        const result = await User.deleteMany()
        res.status(200).json({ result, message: 'User collection deleted successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}
