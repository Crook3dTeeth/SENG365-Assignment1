import Ajv from 'ajv';
import * as EmailValidate from 'email-validator';


const ajv = new Ajv({removeAdditional: 'all', strict: false});

const validate = async (schema: object, data: any): Promise<boolean> => {
    try {
        const validator = ajv.compile(schema);
        const valid = await validator(data);
        if(!valid)
            return false;
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Validates a given email and returns true/false
 * @param email email string
 * @returns true false
 */
const validateEmail = async (email: string): Promise<boolean> => {
    // validate email
    return EmailValidate.validate(email);
}


export {validate, validateEmail}