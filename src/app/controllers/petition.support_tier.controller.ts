import {Request, Response} from "express";
import Logger from "../../config/logger";
import {validate} from '../../config/validation';
import * as schemas from '../resources/schemas.json';
import {deleteTierFromDB, addPetitionTierDB, patchPetitionTier} from "../models/backdoor.model";

const addSupportTier = async (req: Request, res: Response): Promise<void> => {
    try{
        // Checks the petition id is given and that its valid
        const petitionId = req.params.id
        if(petitionId === "" || isNaN(+petitionId)) {
            res.statusMessage = `Bad Request`;
            res.status(400).send();
            return;
        }

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

        const tierData = req.body;

        // Check if the post body is a valid support tier
        const validation = await validate(
            schemas.support_tier_post,
            tierData);
        if(!validation) {
            res.statusMessage = `Bad Request`;
            res.status(400).send();
            return;
        }



        const result = await addPetitionTierDB(petitionId, authToken, tierData);
        switch(result.code) {
            case 201:
                res.statusMessage = `OK`;
                res.status(201).send();
            case 400:
                res.statusMessage = `Bad Request`;
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
                res.statusMessage = `Not Found`;
                res.status(404).send();
                return;
            default:
                res.statusMessage = `Internal Server Error`;
                res.status(500).send();
                return;
        }
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const editSupportTier = async (req: Request, res: Response): Promise<void> => {
    try{
        const petitionData = req.body;
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

        // Check validation schema for the petition and all the tiers the user sends
        const validation = await validate(
            schemas.support_tier_patch, petitionData);

        if(!validation) {
            res.statusMessage = `Bad Request. Invalid information`;
            res.status(400).send();
            return;
        }

        const petitionId = req.params.id;
        const tierId = req.params.tierId;
        // Check that an id was given for the tier and petition ids

        if(petitionId === "" || tierId === "" || isNaN(+petitionId) || isNaN(+tierId)) {
            res.statusMessage = `Bad Request`;
            res.status(400).send();
            return;
        }


        const returnData = await patchPetitionTier(petitionData, authToken, petitionId, tierId);
        switch (returnData) {
            case 200:
                res.statusMessage = "OK";
                res.status(200).send();
                return;
            case 403:
                res.statusMessage = "Forbidden";
                res.status(403).send();
                return;
            case 404:
                res.statusMessage = "Not Found. No petition found with id";
                res.status(404).send();
                return;
            default:
                res.statusMessage = "Internal Server Error";
                res.status(500).send();
                return;
            }
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const deleteSupportTier = async (req: Request, res: Response): Promise<void> => {
    try{
        // Checks for petition id and that its not null
        const petitionId = req.params.id
        const supportTierId = req.params.tierId
        if(petitionId === "" || supportTierId === "" || isNaN(+petitionId) || isNaN(+supportTierId)) {
            res.statusMessage = `Bad Request`;
            res.status(400).send();
            return;
        }

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

        const result = await deleteTierFromDB(petitionId, supportTierId, authToken);
        switch(result) {
            case 200:
                res.statusMessage = `OK`;
                res.status(200).send();
            case 400:
                res.statusMessage = `Bad Request`;
                res.status(400).send();
                return;
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
                res.statusMessage = `Not Found. No petition found with id`;
                res.status(404).send();
                return;
            default:
                res.statusMessage = `Internal Server Error`;
                res.status(500).send();
                return;
        }
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

export {addSupportTier, editSupportTier, deleteSupportTier};