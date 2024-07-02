import * as users from '../models/backdoor.model';
import {Request, Response} from "express";
import Logger from '../../config/logger';
import * as schemas from '../resources/schemas.json';
import {validate, validateEmail} from '../../config/validation';
import { error } from 'console';



const register = async (req: Request, res: Response): Promise<void> => {
    try{
        // Validation of register data
        const validation = await validate(
        schemas.user_register,
        req.body);
        if (validation !== true || await validateEmail(req.body.email) === false) { // Need to validate valid email
            res.statusMessage = `Bad Request. Invalid information`;
            res.status(400).send();
            return;
        }
        // Gets the users info
        const firstName = req.body.firstName;
        const lastName = req.body.lastName;
        const email = req.body.email;
        const password = req.body.password;
        // Checks if the email is in use
        const emailUse = await users.emailInUse(email);
        if (!emailUse) {
            // register the new user
            const result = await users.insertNewUser(email, firstName, lastName, password);
            res.status(201).send({ "userId": result.insertId });
            return;
        } else {
            res.statusMessage = "Forbidden.<ul><li>Email already in use</li></ul>"
            res.status(403).send();
            return;
        }
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const login = async (req: Request, res: Response): Promise<void> => {
    try{
        Logger.http(`POST ${req.body.email} tried logging in`);
        // Validation of login data
        const validation = await validate(
        schemas.user_login,
        req.body);
        // get the user login info
        const pass = req.body.password;
        const email = req.body.email;

        // Validate the email
        const validEmail = await validateEmail(email);
        if (validation !== true || !validEmail) {
            res.statusMessage = `Bad Request. Invalid information`;
            res.status(400).send();
            return;
        }

        // Log the user in (if valid) and return the login token
        const loginToken = await users.checkLogin(email, pass);

        if(loginToken === null) {
            res.statusMessage =  "UnAuthorized. Incorrect email/password";
            res.status(401).send();
            return;
        }
        // correct login, return token of length 64
        Logger.http(`POST ${req.body.email} logged in successfully`);
        res.statusMessage = "OK";
        res.status(200).send(loginToken);
        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const logout = async (req: Request, res: Response): Promise<void> => {
    try{
        // Checks for token and that its not null
        if(!('x-authorization' in req.headers)) {
            res.statusMessage = `Unauthorized`;
            res.status(401).send();
            return;
        }
        let authToken = req.headers['x-authorization'];
        if(!authToken) {
            res.statusMessage = `Unauthorized`;
            res.status(401).send();
            return;
        }
        authToken = authToken.toString();

        // Attempts to log the user out and checks status
        const logoutResult = await users.logoutUser(authToken);
        if(logoutResult) {
            res.statusMessage = "OK";
            res.status(200).send();
            return;
        }
        res.statusMessage = "Unauthorized. Cannot log out if you are not authenticated";
        res.status(401).send();
        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const view = async (req: Request, res: Response): Promise<void> => {
    try{
        // If authed and same id returns email, firstName, lastName
        // all else only firstName, lastName

        // Checks for token and that its not null
        let authToken = null;
        if(('x-authorization' in req.headers)) {
            authToken = req.headers['x-authorization'];
            authToken = authToken.toString();
        }

        const userId = req.params.id;

        const returnResult = await users.viewUser(authToken, userId);
        if(returnResult === null) {
            res.statusMessage = "Not Found. No user with specified ID";
            res.status(404).send();
            return;
        }


        res.statusMessage = "OK";
        res.status(200).send(returnResult);
        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const update = async (req: Request, res: Response): Promise<void> => {
    try{
        // Validate given info
        const data = req.body;
        const validation = await validate(
            schemas.user_edit,
            data);
        if (validation !== true) { // Need to validate valid email
            res.statusMessage = `Bad Request. Invalid information`;
            res.status(400).send();
            return;
        }
        // Checks for token and that its not null
        if(!('x-authorization' in req.headers)) {
            res.statusMessage = `Unauthorized or Invalid currentPassword`;
            res.status(401).send();
            return;
        }
        let authToken = req.headers['x-authorization'];
        if(!authToken) {
            res.statusMessage = `Unauthorized or Invalid currentPassword`;
            res.status(401).send();
            return;
        }
        authToken = authToken.toString();

        // Update the users information and get the status code
        const responseCode = await users.patchUser(data, req.params.id, authToken.toString());


        switch(responseCode) {
            case 200:
                res.statusMessage = `OK`;
                res.status(200).send();
                return;
            case 400:
                res.statusMessage = `Bad request. Invalid information`;
                res.status(400).send();
                return;
            case 401:
                res.statusMessage = `Unauthorized or Invalid currentPassword`;
                res.status(401).send();
                return;
            case 403:
                res.statusMessage = `Forbidden`;
                res.status(403).send();
                return;
            case 404:
                res.statusMessage = `Not Found`;
                res.status(404).send();
                return;
            case 500:
                throw error;
        }


        throw error;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

export {register, login, logout, view, update}