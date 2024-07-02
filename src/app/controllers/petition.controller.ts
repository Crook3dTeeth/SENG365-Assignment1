import {Request, Response} from "express";
import Logger from '../../config/logger';
import * as petitions from '../models/backdoor.model';
import {validate} from '../../config/validation';
import * as schemas from '../resources/schemas.json';

const getAllPetitions = async (req: Request, res: Response): Promise<void> => {
    try{
        // Store petition args in array
        const url = new URL(req.url, 'http://localhost');
        const parameters = url.searchParams;
        const petitionArgs = {
            "startIndex" : "",
            "count" : "",
            "q" : "",
            "categoryIds" : {},
            "supportingCost" : "",
            "ownerId" : "",
            "supporterId" : "",
            "sortBy" : "",
        };

        // Check if categoryIds that it has a value(s) given
        const categories = parameters.get("categoryIds");
        if(categories === "") {
            res.statusMessage = "Bad request";
            res.status(400).send();
            return;
        }

        // Extracts the given params
        petitionArgs.startIndex = parameters.get("startIndex");
        petitionArgs.count = parameters.get("count");
        petitionArgs.q = parameters.get("q");
        petitionArgs.categoryIds = parameters.getAll("categoryIds");
        petitionArgs.supportingCost = parameters.get("supportingCost");
        petitionArgs.ownerId = parameters.get("ownerId");
        petitionArgs.supporterId = parameters.get("supporterId");
        petitionArgs.sortBy = parameters.get("sortBy");

        // Checks if any parameters don't have a value
        let badValue = false;
        Object.entries(petitionArgs).forEach(
            ([key, value]) => {
                if((value === "")&& !(badValue)) {
                    res.statusMessage = "Bad request";
                    badValue = true;
                    res.status(400).send();
                    return;
                }
            }
        );

        // let purgedResults = [];
        if(!badValue) {
            const petitionResult = await petitions.getPetitionFromDB(petitionArgs);

            // returns false if an invalid sort by option provided
            if(!petitionResult) {
                res.statusMessage = "Bad request";
                res.status(400).send();
                return;
            }

            // Checks what values need to be sent
            let purgedResults = petitionResult;
            if(petitionArgs.count && petitionArgs.startIndex) {
                const endIndex = (Number(petitionArgs.count) + Number(petitionArgs.startIndex));
                purgedResults = petitionResult.slice(petitionArgs.startIndex, endIndex);
            } else if(petitionArgs.startIndex) {
                purgedResults = petitionResult.slice(petitionArgs.startIndex);
            } else if(petitionArgs.count){
                purgedResults = petitionResult.slice(0, petitionArgs.count);
            }

            // data skeleton of return data
            const resData = {
                "petitions" : purgedResults,
                "count" : petitionResult.length
            };

            if(resData.count === 0) {
                res.statusMessage = "Bad Request";
                res.status(400).send();
                return;
            }

            res.statusMessage = "OK";
            res.status(200).send(resData);
        }
        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}


const getPetition = async (req: Request, res: Response): Promise<void> => {
    try{
        // Your code goes here

        const userId = req.params.id;
        const petitionData = await petitions.getDetailedPetition(userId);
        if(petitionData === null) {
            res.statusMessage = "Not Found. No petition with id";
            res.status(404).send();
            return;
        }

        // Send the data
        res.statusMessage = "OK";
        res.status(200).send(petitionData);

        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const addPetition = async (req: Request, res: Response): Promise<void> => {
    try{
        const petitionData = req.body;
        const supportTiers = petitionData.supportTiers;

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
            schemas.petition_post,
            petitionData);
        let tiersValidation = true
        for(const tier in supportTiers) {
            if(!await validate(
                schemas.support_tier_post,
                supportTiers[tier])) {
                    tiersValidation = false;
                }
        }

        const titles = new Set();
        let isUnique = true;
        for(const tier in supportTiers) {
            if(titles.has(supportTiers[tier].title)) {
                isUnique = false;
            } else {
                titles.add(supportTiers[tier].title);
            }
        }


        if(!(validation && tiersValidation && isUnique)) {
            res.statusMessage = "Bad Request";
            res.status(400).send();
            return;
        }

        const returnData = await petitions.addPetition(petitionData, authToken)
        switch (returnData.code) {
            case 201:
                res.statusMessage = "Created";
                res.status(201).send({"petitionId":returnData.id});
                return;
            case 400:
                res.statusMessage = "Bad Request";
                res.status(400).send();
                return;
            case 401:
                res.statusMessage = "Unauthorized";
                res.status(401).send();
                return;
            case 403:
                res.statusMessage = "Forbidden";
                res.status(403).send();
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

const editPetition = async (req: Request, res: Response): Promise<void> => {
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
            schemas.petition_patch, petitionData);

        if(!validation) {
            res.statusMessage = `Bad Request. Invalid information`;
            res.status(400).send();
            return;
        }

        const userId = req.params.id;

        // Perform the patch
        const returnData = await petitions.patchPetition(petitionData, authToken,userId)
        // Check the resulting status code
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

const deletePetition = async (req: Request, res: Response): Promise<void> => {
    try{
        // Check petition id given is a valid number
        const petitionId = req.params.id
        if(petitionId === "") {
            res.statusMessage = `Unauthorized`;
            res.status(401).send();
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

        // attempts to deletes petition and checks the status code to send to user
        const result = await petitions.deletePetFromDB(petitionId, authToken);
        switch(result) {
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

const getCategories = async(req: Request, res: Response): Promise<void> => {
    try{

        // Gets the petition categories
        const returnData = await petitions.getCatsFromDB();
        res.status(200).send(returnData);


        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

export {getAllPetitions, getPetition, addPetition, editPetition, deletePetition, getCategories};