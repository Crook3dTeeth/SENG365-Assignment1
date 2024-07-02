import {Request, Response} from "express";
import Logger from "../../config/logger";
import {getPetitionSupporters} from "../models/backdoor.model";


const getAllSupportersForPetition = async (req: Request, res: Response): Promise<void> => {
    try{
        // Check that a valid petition id was given
        const petitionId = req.params.id;
        if(petitionId === "" || isNaN(+petitionId)) {
            res.statusMessage = `Not Found. No petition with id`;
            res.status(404).send();
            return;
        }

        // Get the support data
        const supportData = await getPetitionSupporters(petitionId);

        // check if there was no petition found with the id
        if(supportData === null) {
            res.statusMessage = `Not Found. No petition with id`;
            res.status(404).send();
            return;
        }

        // Return the user data
        res.statusMessage = `OK`;
        res.status(200).send(supportData);
        return;



    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

const addSupporter = async (req: Request, res: Response): Promise<void> => {
    try{
        // Your code goes here
        res.statusMessage = "Not Implemented Yet!";
        res.status(501).send();
        return;
    } catch (err) {
        Logger.error(err);
        res.statusMessage = "Internal Server Error";
        res.status(500).send();
        return;
    }
}

export {getAllSupportersForPetition, addSupporter}