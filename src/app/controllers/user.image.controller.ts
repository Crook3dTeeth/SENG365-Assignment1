import {Request, Response} from "express";
import * as users from '../models/backdoor.model';
import Logger from "../../config/logger";
import { error } from "console";

const getImage = async (req: Request, res: Response): Promise<void> => {
    try{
        const photo = await users.getImagePath(req.params.id);

        if(photo === null) {
            res.statusMessage = "Not Found. No user with specified ID, or user has no image";
            res.status(404).send();
            return;
        }

        // gets the correct image type format
        // damn you jpg!
        let extType = photo[1].slice(-3);
        if(extType === 'jpg' || extType === 'peg') {
            extType = 'jpeg';
        }
        extType = 'image/'.concat(extType);

        // Sends the image
        res.writeHead(200, {'Content-Type': extType});
        res.end(photo[0]);
        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const setImage = async (req: Request, res: Response): Promise<void> => {
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

        // Checks for content type and that its not null
        if(!('content-type' in req.headers)) {
            res.statusMessage = `Unauthorized`;
            res.status(400).send();
            return;
        }
        let imageType = req.headers['content-type'];
        if(!imageType) {
            res.statusMessage = `Unauthorized`;
            res.status(400).send();
            return;
        }
        imageType = imageType.toString();

        switch(imageType) {
            case 'image/png':
                imageType = '.png';
                break;
            case 'image/jpeg':
                imageType = '.jpg';
                break;
            case 'image/gif':
                imageType = '.gif';
                break;
            default:
                res.statusMessage = `Bad Request. Invalid image supplied (possibly incorrect file type)`;
                res.status(400).send();
                return;
        }


        const imageStatus = await users.setImagePath(req.params.id, authToken, req.body, imageType);

        switch(imageStatus) {
            case 200:
                res.statusMessage = `OK. Image updated`;
                res.status(200).send();
                return;
            case 201:
                res.statusMessage = `Created. New image created`;
                res.status(201).send();
                return;
            case 400:
                res.statusMessage = `Bad Request. Invalid image supplied (possibly incorrect file type)`;
                res.status(400).send();
                return;
            case 401:
                res.statusMessage = `Unauthorized`;
                res.status(401).send();
                return;
            case 403:
                res.statusMessage = `Forbidden`;
                res.status(403).send();
                return;
            case 404:
                res.statusMessage = `Not found. No such user with ID given`;
                res.status(404).send();
                return;
        }

        throw error("unknown imageStatus code");
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const deleteImage = async (req: Request, res: Response): Promise<void> => {
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

        const imageStatus = await users.deleteImagePath(req.params.id, authToken);

        switch(imageStatus) {
            case 200:
                res.statusMessage = `OK`;
                res.status(200).send();
                return;
            case 401:
                res.statusMessage = `Unauthorized`;
                res.status(401).send();
                return;
            case 403:
                res.statusMessage = `Forbidden`;
                res.status(403).send();
                return;
            case 404:
                res.statusMessage = `Not found. No such user with ID given`;
                res.status(404).send();
                return;
        }

        throw error("unknown imageStatus code");
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

export {getImage, setImage, deleteImage}