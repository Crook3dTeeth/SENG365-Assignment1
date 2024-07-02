import {getPool} from "../../config/db";
import fs from 'mz/fs';
import * as defaultUsers from "../resources/default_users.json"
import * as passwords from "../services/passwords";
const imageDirectory = './storage/images/';
const defaultPhotoDirectory = './storage/default/';

import Logger from "../../config/logger";
import {OkPacket, ResultSetHeader, RowDataPacket} from "mysql2";
import { hash } from "bcrypt";
import { error } from "console";
import * as token from 'rand-token';
import { validateEmail } from "../../config/validation";
import { title } from "process";


const resetDb = async (): Promise<any> => {
    const promises = [];

    const sql = await fs.readFile('src/app/resources/create_database.sql', 'utf8');
    Logger.info("Resetting Database...");
    promises.push(getPool().query(sql));  // sync call to recreate DB

    const files = await fs.readdir(imageDirectory);
    for (const file of files) {
        if (file !== '.gitkeep') promises.push(fs.unlink(imageDirectory + file));  // sync call to delete photo
    }

    return Promise.all(promises);  // async wait for DB recreation and images to be deleted
};

const loadData = async (): Promise<any> => {
    await populateDefaultUsers();
    try {
        const sql = await fs.readFile('src/app/resources/resample_database.sql', 'utf8');
        await getPool().query(sql);
    } catch (err) {
        Logger.error(err.sql);
        throw err;
    }

    const defaultPhotos = await fs.readdir(defaultPhotoDirectory);
    const promises = defaultPhotos.map((file: string) => fs.copyFile(defaultPhotoDirectory + file, imageDirectory + file));
    return Promise.all(promises);
};

const insertNewUser = async (email : string, firstName: string, lastName: string, password: string) : Promise<ResultSetHeader> => {
    Logger.info(`Adding user ${firstName} to the database`);
    const conn = await getPool().getConnection();

    const passHash = await passwords.hash(password);

    const query = 'INSERT INTO `user` (email, first_name, last_name, password) VALUES ( ?, ?, ?, ? )';
    const [ result ] = await conn.query( query, [email, firstName, lastName, passHash] );
    await conn.release();
    return result;
};

/**
 * Checks if an email is already in use
 * @param email email string
 * @param sqlConn sql pool connection if already in use
 * @returns true/false
 */
const emailInUse = async(email: string, sqlConn: object = null) : Promise<any> => {
    try {
        // checks if a sqlConn was provided makes one if not
        let conn = null;
        let connSuppl = false;
        if (sqlConn === null) {
            conn = await getPool().getConnection();
        } else {
            connSuppl = true;
            conn = sqlConn;
        }

        const query = 'SELECT * FROM `user` where (email) = ( ? )';
        const [ result ] = await conn.query( query, [email] );

        if(!connSuppl) { // only close connection if db connection not supplied
            await conn.release();
        }

        if (result.length === 0) {
            return false;
        }
        return true;
    } catch(err) {
        throw error(err);
    }
};


/**
 * Returns data on a user 
 * If they're the user they'll get private info
 * @param authToken 
 * @param userId 
 * @returns 
 */
const viewUser = async(authToken: string, userId: string) : Promise<any> => {
    try {
        const conn = await getPool().getConnection();
        // tries to set auth_token in user to none and checks if any rows were affected
        const query = 'SELECT first_name, last_name, email, auth_token FROM `user` WHERE (id) = ( ? )';
        const [ result ] = await conn.query( query, [userId] );
        await conn.release();

        if(result.length === 0) {
            return null;
        }


        if(result[0].auth_token === authToken) {
            // Return all the user data
            const fullUserData = {'firstName' : result[0].first_name, 'lastName' : result[0].last_name, 'email' : result[0].email}
            return fullUserData;
        }
        const partialUserData = {'firstName' : result[0].first_name, 'lastName' : result[0].last_name}

        return partialUserData;
    } catch(err) {
        throw error(err);
    }
}

/**
 * Updates the users info if they're the user
 * @param data 
 * @param userId 
 * @param authToken 
 * @returns 
 */
const patchUser = async(data: object, userId: string, authToken : string) : Promise<number> => {
    try{
        // Check if user id is a number
        if(isNaN(+userId)) {
            return 400;
        }
        
        // Gets the user info
        const conn = await getPool().getConnection();
        const validAuth = 'SELECT * FROM `user` WHERE ( id ) = ( ? )'
        let validAuthResult  = [];
        try {
            validAuthResult = await conn.query( validAuth, [userId] );

        } catch (err){
            Logger.error(err);
            return 400;
        }

        // Checks if the user is trying their own info
        const userData = validAuthResult[0][0];
        if(userData.auth_token !== authToken) {
            await conn.release();
            return 403;
        }

        // Construct a query based on the given information
        const queriesVars = [];
        let queries = 'UPDATE `user` SET ';
        let setQuery = '';
        if("email" in data) {
            const email = data.email.toString();
            if(await emailInUse(email, conn)) {
                await conn.release();
                return 403;
            }

            if(!await validateEmail(email)) {
                await conn.release();
                return 400;
            }

            setQuery = setQuery.concat('email = ?,');
            queriesVars.push(email);
        }
        if('password' in data) {
            if('currentPassword' in data) {
                const password = data.password.toString();
                const currPassword = data.currentPassword.toString();
                // Check if the new password is different
                if(! await passwords.compare(currPassword, userData.password)) {
                    await conn.release();
                    return 401;
                }

                if (password !== currPassword) {
                    setQuery = setQuery.concat('password = ?,');
                    queriesVars.push(await passwords.hash(password)); // hash password
                } else {
                    await conn.release();
                    return 403;
                }
            } else {
                await conn.release();
                return 401;
            }
        }
        if('firstName' in data) {
            setQuery = setQuery.concat('firstName = ?,');
            queriesVars.push(data.firstName);
        }
        if('lastName' in data) {
            setQuery = setQuery.concat('lastName = ?,');
            queriesVars.push(data.lastName);
        }
        setQuery = setQuery.substring(0, setQuery.length-1);
        queries = queries.concat(setQuery);
        queries = queries.concat(' WHERE id = ?;');
        queriesVars.push(userId);


        const [ pathResult ] = await conn.query( queries, queriesVars );


        return 200;
    } catch (err){
        Logger.error(err);
        return 500;
    }
};



const logoutUser = async(authToken: string) : Promise<any> => {
    const conn = await getPool().getConnection();
    // tries to set auth_token in user to none and checks if any rows were affected
    const query = 'UPDATE `user` SET auth_token = NULL WHERE auth_token = ?';
    const [ result ] = await conn.query( query, [authToken] );
    await conn.release();
    if (result.changedRows === 0) {
        return false;
    } else if (result.changedRows === 1)
    {
        return true;
    }
    Logger.error("ERROR: Duplicate auth_token present in database!");
    throw error;
}


const checkLogin = async(email: string, password: string) : Promise<any> => {
    // get hashed password from user with given email
    const conn = await getPool().getConnection();
    const query = 'SELECT password FROM `user` WHERE (email) = ( ? )';
    const [ result ] = await conn.query( query, [email] );

    if(result.length > 1 ) {
        // more than one entry for the same email
        // uh oh
        await conn.release();
        throw error;
    } else if(result.length === 0) {
        // Email not registered
        await conn.release();
        return null;
    }
    // Uses password compare function and returns if the passwords are the same :)
    const isCorrectLogin = await passwords.compare(password, result[0].password);
    if(!isCorrectLogin)
    {
        return null;
    }

    // generate random token and update the db with it
    const genToken = token.generate(64);
    const tokenQuery = 'UPDATE `user` SET auth_token = ? WHERE email = ?; SELECT id FROM `user` WHERE email = ?';
    const [ tokenResult ] = await conn.query( tokenQuery, [genToken, email, email] );

    await conn.release();
    const returnResult = {'token' : genToken, 'userId' : tokenResult[1][0].id};

    return returnResult;
};


const getImagePath = async(userId: string) : Promise<any> => {
    try {
        const conn = await getPool().getConnection();
        // gets users image info
        const query = 'SELECT `image_filename` FROM `user` WHERE (id) = ( ? )';
        const [ result ] = await conn.query( query, [userId] );
        await conn.release();

        if(result.length > 1 ) {
            // more than one entry for the same id
            // uh oh
            throw error;
        } else if(result.length === 0) {
            // id not registered or no image
            return null;
        }
        const imagePath = result[0].image_filename;
        if(imagePath === null) {
            return null;
        }
        const fullImagePath = imageDirectory.concat(imagePath);

        if(!fs.existsSync(fullImagePath)) {
            return null;
        }
        const image = fs.readFileSync(fullImagePath);


        return [image, imagePath];
    }
    catch(err) {
        throw error(err.message);
    }
}

const getCatImagePath = async(catId: string) : Promise<any> => {
    try {
        const conn = await getPool().getConnection();
        // gets users image info
        const query = 'SELECT `image_filename` FROM `petition` WHERE (id) = ( ? )';
        const [ result ] = await conn.query( query, [catId] );
        await conn.release();

        if(result.length > 1 ) {
            // more than one entry for the same id
            // uh oh
            throw error;
        } else if(result.length === 0) {
            // id not registered or no image
            return null;
        }
        const imagePath = result[0].image_filename;
        if(imagePath === null) {
            return null;
        }
        const fullImagePath = imageDirectory.concat(imagePath);

        if(!fs.existsSync(fullImagePath)) {
            return null;
        }
        const image = fs.readFileSync(fullImagePath);


        return [image, imagePath];
    }
    catch(err) {
        throw error(err.message);
    }
}


const setPetitionPath = async(petId: string, authToken: string, imageBody: object, imageType: string) : Promise<any> => {
    try {
        // Invalid user id
        if(isNaN(+petId)) {
            return 404;
        }

        const conn = await getPool().getConnection();
        // gets users image info
        const query = 'SELECT user.auth_token, petition.image_filename FROM `petition` JOIN user ON user.id = petition.owner_id WHERE petition.id = ( ? )';
        const [ result ] = await conn.query( query, [petId] );
        await conn.release();

        if(result.length > 1 ) {
            // more than one entry for the same id
            // uh oh
            throw error;
        } else if(result.length === 0) {
            // id not registered or no image
            await conn.release();
            return 404;
        }

        const userData = result[0];
        if(userData.auth_token !== authToken) {
            await conn.release();
            return 403;
        }

        const imagePath = imageDirectory.concat("petition_", petId, imageType);

        fs.writeFile(imagePath, imageBody);

        const updatePathQuery = 'UPDATE `petition` SET image_filename = ? WHERE id = ?';
        const [ imageResult ] = await conn.query( updatePathQuery, ["petition_".concat(petId, imageType), petId]);



        if(userData.image_filename === null || userData.image_filename === '') {
            await conn.release();
            return 201;
        } else {
            await conn.release();
            return 200;
        }
    }
    catch(err) {
        throw error(err.message);
    }
}



const setImagePath = async(userId: string, authToken: string, imageBody: object, imageType: string) : Promise<any> => {
    try {
        // Invalid user id
        if(isNaN(+userId)) {
            return 404;
        }

        const conn = await getPool().getConnection();
        // gets users image info
        const query = 'SELECT * FROM `user` WHERE (id) = ( ? )';
        const [ result ] = await conn.query( query, [userId] );
        await conn.release();

        if(result.length > 1 ) {
            // more than one entry for the same id
            // uh oh
            throw error;
        } else if(result.length === 0) {
            // id not registered or no image
            await conn.release();
            return 404;
        }

        const userData = result[0];
        if(userData.auth_token !== authToken) {
            await conn.release();
            return 403;
        }

        const imagePath = imageDirectory.concat("user_", userId, imageType);

        fs.writeFile(imagePath, imageBody);

        const updatePathQuery = 'UPDATE `user` SET image_filename = ? WHERE id = ?';
        const [ imageResult ] = await conn.query( updatePathQuery, ["user_".concat(userId, imageType), userId]);



        if(userData.image_path === null) {
            await conn.release();
            return 201;
        } else {
            await conn.release();
            return 200;
        }
    }
    catch(err) {
        throw error(err.message);
    }
}


const deleteImagePath = async(userId: string, authToken: string) : Promise<any> => {
    try {
        // Invalid user id
        if(isNaN(+userId)) {
            return 404;
        }

        const conn = await getPool().getConnection();
        // gets users image info
        const query = 'SELECT * FROM `user` WHERE (id) = ( ? )';
        const [ result ] = await conn.query( query, [userId] );
        await conn.release();

        if(result.length > 1 ) {
            // more than one entry for the same id
            // uh oh
            throw error;
        } else if(result.length === 0) {
            // id not registered or no image
            return 404;
        }

        const userData = result[0];
        if(userData.auth_token !== authToken) {
            await conn.release();
            return 403;
        }

        const updatePathQuery = 'UPDATE `user` SET image_filename = null WHERE id = ?';
        const [ imageResult ] = await conn.query( updatePathQuery, [userId]);
        return 200;

    }
    catch(err) {
        throw error(err.message);
    }
}




const getPetitionFromDB = async(args: Record<string, any>) : Promise<any> => {
    try {
        const orderBy = args.sortBy;

        const searchString = args.q;
        const catId = args.categoryIds;
        const tierCost = args.supportingCost;
        const ownerId = args.ownerId;
        const supporterId = args.supporterId;

        // This is my Friday afternoon
        let query = 'SELECT petition.id AS petitionId, petition.title, petition.category_id AS categoryId, petition.owner_id AS ownerId, user.first_name AS ownerFirstName, user.last_name AS ownerLastName, COUNT(supporter.petition_id) AS numberOfSupporters, petition.creation_date AS creationDate, support_tier.cost AS supportingCost FROM petition JOIN support_tier ON petition.id = support_tier.petition_id JOIN user on user.id = petition.owner_id LEFT JOIN supporter on supporter.support_tier_id = support_tier.id';
        // This makes the magic happen (and pain apparently)
        const suffix = ' GROUP BY petition.id';

        const queryVars = [];

        // Check if the WHERE statement is needed
        if(!(searchString === null && catId.length === 0 && tierCost === null && ownerId === null && supporterId === null)) {
            query = query.concat(" WHERE ");
        }

        let andNeeded = false;

        if(searchString) {
            const searchQ = "%".concat(searchString, "%");
            query = query.concat("(petition.title LIKE ? OR petition.description LIKE ?)");
            queryVars.push(searchQ);
            queryVars.push(searchQ);
            andNeeded = true;
        }

        if(catId.length > 0) {
            if(andNeeded) {
                query = query.concat(" AND ");
            }

            let firstCat = true;
            for(const key in catId) {
                if(firstCat) {
                    queryVars.push(catId[key]);
                    query = query.concat("(petition.category_id = ?");
                    firstCat = false;
                } else {
                    queryVars.push(catId[key]);
                    query = query.concat("OR petition.category_id = ?");
                }
            }

            query = query.concat(")");
            andNeeded = true;

        }

        if(tierCost) {
            if(andNeeded) {
                query = query.concat(" AND ");
            }
            andNeeded = true;
            queryVars.push(tierCost);
            query = query.concat("support_tier.cost <= ?");
        }

        if(ownerId) {
            if(andNeeded) {
                query = query.concat(" AND ");
            }
            andNeeded = true;
            queryVars.push(ownerId);
            query = query.concat("petition.owner_id = ?");
        }

        if(supporterId) {
            if(andNeeded) {
                query = query.concat(" AND ");
            }
            andNeeded = true;
            queryVars.push(supporterId);
            query = query.concat("supporter.user_id = ?");
        }


        // Finish off the query
        query = query.concat(suffix);


        // How to order the results
        switch(orderBy) {
            case "ALPHABETICAL_ASC":
                query = query.concat(" ORDER BY petition.title ASC");
                break;
            case "ALPHABETICAL_DESC":
                query = query.concat(" ORDER BY petition.title DESC");
                break;
            case "COST_ASC":
                query = query.concat(" ORDER BY support_tier.cost ASC");
                break;
            case "COST_DESC":
                query = query.concat(" ORDER BY support_tier.cost DESC");
                break;
            case "CREATED_ASC":
                query = query.concat(" ORDER BY petition.creation_date ASC");
                break;
            case "CREATED_DESC":
                query = query.concat(" ORDER BY petition.creation_date DESC");
                break;
            case null:
                query = query.concat(" ORDER BY petition.creation_date ASC");
                break;
            default:
                return false;
        }

        const conn = await getPool().getConnection();
        const [ petitionResult ] = await conn.query( query, queryVars);
        await conn.release();

        return petitionResult;


    }
    catch(err) {
        throw error(err.message);
    }
}

const getDetailedPetition = async(petId: string) : Promise<any> => {
    try {
        // 2 requests to be done
        const conn = await getPool().getConnection();
        // The magic query
        const petitionQuery = 'SELECT petition.id AS petitionId, petition.title, petition.category_id AS categoryId, petition.owner_id AS ownerId, user.first_name AS firstName, user.last_name AS lastName, COUNT(supporter.id) AS numberOfSupporters, petition.creation_date AS creationDate, petition.description, SUM(support_tier.cost) AS moneyRaised FROM petition JOIN supporter ON petition.id = supporter.petition_id JOIN support_tier ON supporter.support_tier_id = support_tier.id JOIN user on user.id = petition.owner_id WHERE petition.id = ? ORDER BY `moneyRaised`  DESC;';
        const [petionResult] = await conn.query( petitionQuery, [petId]);

        // Check if something was returned/if it was a valid id
        if(petionResult[0].categoryId === null) {
            return null;
        }
        const returnData = petionResult[0]
        // Get the support tiers for the petition
        const tierQuery = 'SELECT support_tier.title, support_tier.description, support_tier.cost, support_tier.id FROM support_tier WHERE support_tier.petition_id = ? ORDER BY support_tier.id ASC';
        const [tierResult] = await conn.query( tierQuery, [petId]);

        returnData.supportTiers = [];
        returnData.supportTiers = tierResult;

        await conn.release();

        return returnData;

    } catch(err) {
        throw error(err);
    }

}

const getCatsFromDB = async() : Promise<any> => {
    try {

        const query = 'SELECT category.id as categoryId, category.name FROM category ORDER BY `categoryId` ASC';
        const conn = await getPool().getConnection();
        const [ queryResult ] = await conn.query( query, []);
        return queryResult;


    } catch(err){
        throw error(err);
    }
}


const deletePetFromDB = async(petitionId: string, requestAuth: string) : Promise<any> => {
    try {

        const userQuery = 'SELECT * FROM user WHERE user.auth_token = ?';

        // const petitionQuery = 'SELECT petition.*, COUNT(supporter.petition_id) AS Supporters FROM `petition` JOIN supporter on supporter.petition_id = petition.id WHERE petition.id = 5 AND petition.owner_id = 9;';
        // const petitionQuery = 'DELETE FROM `petition` WHERE id = ? AND owner_id = ? AND (SELECT COUNT(*) FROM supporter WHERE petition_id = ?) = 0; SELECT * FROM `petition` WHERE petition.id = ? AND petition.owner_id = ?;';


        const conn = await getPool().getConnection();
        const [userQueryResult] = await conn.query( userQuery, [requestAuth]);
        if(requestAuth !== userQueryResult[0].auth_token) {
            await conn.release();
            return 403;
        }

        const userId = userQueryResult[0].id;

        // Deletes the potential petition and then gets the result
        const petitionQuery = 'DELETE FROM `petition` WHERE petition.id = ? AND petition.owner_id = ? AND (SELECT COUNT(*) FROM supporter WHERE supporter.petition_id = ?) = 0; SELECT * FROM `petition` WHERE petition.id = ? AND petition.owner_id = ?;';
        const deleteQueryResult = await conn.query( petitionQuery, [petitionId, userId, petitionId, petitionId, userId]);

        await conn.release();

        // A row was deleted
        if(deleteQueryResult[0][0].affectedRows !== 0) {
            return 200;
        }

        if(deleteQueryResult[1][1].length !== 0) { // There is still a petition
            return 403;
        } else { // There is no petition and nothing was updated
            return 404
        }


    } catch(err){
        throw error(err);
    }
}


const addPetition = async(petitionData: any, requestAuth: string) : Promise<any> => {
    try {
        const conn = await getPool().getConnection();

        const authQuery = 'SELECT `id` FROM `user` WHERE auth_token = ?';
        const [userQueryResult] = await conn.query( authQuery, [requestAuth]);

        if(userQueryResult.length === 0) {
            await conn.release();
            return {"code":401};
        }
        const userId = userQueryResult[0].id;

        const checkTitleQuery = 'SELECT * FROM `petition` WHERE title = ?'
        const [checkTitleQueryResult] = await conn.query( checkTitleQuery, [petitionData.title]);

        if(checkTitleQueryResult.length !== 0) {
            await conn.release();
            return {"code":403};
        }


        const addPetititionQuery = 'INSERT INTO `petition` (`title`, `description`, `creation_date`, `owner_id`, `category_id`) VALUES (?, ?, (SELECT CURRENT_TIMESTAMP), ?, ?);';
        const [petitionQueryResult] = await conn.query( addPetititionQuery, [petitionData.title, petitionData.description, userId, petitionData.categoryId]);

        if(petitionQueryResult.affectedRows === 0) {
            await conn.release();
            return {"code":403};
        }

        const petitionId = petitionQueryResult.insertId;


        const tierQuery = 'INSERT INTO `support_tier` (`petition_id`, `title`, `description`, `cost`) VALUES (?, ?, ?, ?)';


        for (const values of petitionData.supportTiers) {
            const [supportQueryResult] = await conn.query(tierQuery, [petitionId, values.title, values.description, values.cost]);

            if(supportQueryResult.affectedRows === 0) {
                await conn.release();
                return {"code":500};
            }

        }
        await conn.release();
        return {"code":201, "id":petitionId};


    } catch(err){
        throw error(err);
    }
}

/**
 * Updates/edits a petitions information
 * @param petitionData
 * @param requestAuth
 * @param petitionId
 * @returns status code
 */
const patchPetition = async(petitionData: any, requestAuth: string, petitionId: string) : Promise<any> => {
    try {
        const conn = await getPool().getConnection();

        const authQuery = 'SELECT `id` FROM `user` WHERE auth_token = ?';
        const [userQueryResult] = await conn.query( authQuery, [requestAuth]);

        if(userQueryResult.length === 0) {
            await conn.release();
            return 403;
        }
        const userId = userQueryResult[0].id;

        const checkTitleQuery = 'SELECT * FROM `petition` WHERE id = ?'
        const [checkTitleQueryResult] = await conn.query( checkTitleQuery, [petitionId]);

        if(checkTitleQueryResult.length === 0) {
            await conn.release();
            return 404;
        }

        if(checkTitleQueryResult[0].owner_id !== userId) {
            await conn.release();
            return 403;
        }

        // Construct the query based on the given data
        const queryVars = [];
        let query = 'UPDATE `petition` SET ';
        let addedVar = false;
        if("title" in petitionData) {
            query = query.concat(`title = ?`);
            addedVar = true;
            queryVars.push(petitionData.title);
        }
        if("description" in petitionData) {
            if(addedVar) {
                query = query.concat(`, `);

            }
            query = query.concat(`description = ?`);
            addedVar = true;
            queryVars.push(petitionData.description);
        }
        if("categoryId" in petitionData) {
            if(addedVar) {
                query = query.concat(`, `);
            }
            query = query.concat(`category_id = ?`);
            addedVar = true;
            queryVars.push(petitionData.categoryId);
        }
        query = query.concat(" WHERE id = ?");
        queryVars.push(petitionId);


        // Edit the petition
        const [petitionQueryResult] = await conn.query(query, queryVars);
        await conn.release();
        if(petitionQueryResult.affectedRows === 0) { // Check if something was changed
            return 403;
        }


        return 200;


    } catch(err){
        if(err.code === 'ER_DUP_ENTRY') {
            return 403;
        }
        throw error(err);
    }
}

/**
 * Deletes a support tier if the user is the owner and there aren't any supporters
 * @param petitionId Id of the petition
 * @param supportTierId Id of the support tier for the petition
 * @param requestAuth Requesting users auth code
 * @returns status code
 */
const deleteTierFromDB = async(petitionId: string, supportTierId: string, requestAuth: string) : Promise<any> => {
    try {
        const userQuery = 'SELECT * FROM user WHERE user.auth_token = ?';
        const conn = await getPool().getConnection();
        const [userQueryResult] = await conn.query( userQuery, [requestAuth]);

        // Verify the user requesting
        if(userQueryResult.length === 0) {
            await conn.release();
            return 401;
        }
        if(requestAuth !== userQueryResult[0].auth_token) {
            await conn.release();
            return 403;
        }

        const userId = userQueryResult[0].id;

        // Verify the requesting user is the owner
        const petitionQuery = "SELECT owner_id FROM `petition` WHERE id = ?"
        const [petitionQueryResult] = await conn.query( petitionQuery, [petitionId]);
        if(petitionQueryResult[0].owner_id !== userId) {
            await conn.release();
            return 403;
        }

        // Finds tier with given id and no supporters
        const supportTierQuery = "SELECT support_tier.* FROM `support_tier` LEFT join supporter on supporter.support_tier_id = support_tier.id WHERE support_tier.id = ? GROUP BY support_tier.id HAVING COUNT(supporter.support_tier_id) = 0;";
        const [tierQueryResult] = await conn.query( supportTierQuery, [supportTierId]);

        // Check if there is are no tiers returned
        if(tierQueryResult.length === 0) {
            await conn.release();
            return 404;
        }

        // Delete the support tier
        const deleteTierQuery = "DELETE FROM `support_tier` WHERE id = ?";
        const [deleteTierResult] = await conn.query( deleteTierQuery, [supportTierId]);
        await conn.release();
        // Check if something was actually deleted
        if(deleteTierResult.affectedRows === 0) {
            return 403;
        }


        return 200;

    } catch(err){
        throw error(err);
    }
}


/**
 * Adds a new support tier to a petition if there aren't already 3 and the title is unique for
 * the petition tiers
 * @param petitionId Id of the petition to add the tier to
 * @param requestAuth Auth of the requesting user
 * @param petitionData Data of the new support tier
 * @returns {"code": response code, "id": new petition tier id}
 */
const addPetitionTierDB = async(petitionId: string, requestAuth: string, petitionData: any): Promise<any> => {
    // Get the user id associated with the auth_token
    const userQuery = 'SELECT * FROM user WHERE user.auth_token = ?';
    const conn = await getPool().getConnection();
    const [userQueryResult] = await conn.query( userQuery, [requestAuth]);

    // Verify the user requesting
    if(userQueryResult.length === 0) {
        await conn.release();
        return {"code" :401, "id": null};
    }
    const userId = userQueryResult[0].id;

    // Gets the petition to add the tier to
    const petitionQuery = "SELECT owner_id FROM `petition` WHERE id = ?"
    const [petitionQueryResult] = await conn.query( petitionQuery, [petitionId]);
    if(petitionQueryResult.length === 0) {
        await conn.release();
        return {"code" :404, "id": null};
    }
    // Checks the requesting user is the owner
    if(petitionQueryResult[0].owner_id !== userId) {
        await conn.release();
        return {"code" :403, "id": null};
    }

    // Gets the current support tiers of the petition
    const supportTierQuery = "SELECT * FROM `support_tier` WHERE petition_id = ?"
    const [tierQueryResult] = await conn.query( supportTierQuery, [petitionId]);
    if(tierQueryResult.length === 3) { // Check if the max is already reached
        await conn.release();
        return {"code" :403, "id": null};
    }

    // Check if the new title of the tier is unique
    const titles = new Set();
    titles.add(petitionData.title);
    let isUnique = true;
    for(const tier in tierQueryResult) {
        if(titles.has(tierQueryResult[tier].title)) {
            isUnique = false;
        } else {
            titles.add(tierQueryResult[tier].title);
        }
    }
    if(!isUnique) {
        await conn.release();
        return {"code" :403, "id": null};
    }

    // Add the new tier
    const addSupportTierQuery = "INSERT INTO `support_tier` (`petition_id`, `title`, `description`, `cost`) VALUES (?, ?, ?, ?)";
    const [addTierResult] = await conn.query( addSupportTierQuery, [petitionId, petitionData.title, petitionData.description, petitionData.cost]);
    await conn.release();
    // Check if something was actually inserted
    if(addTierResult.affectedRows === 0) {
        return {"code" :403, "id": null};
    }

    return {"code" :201, "id": null};
}

/**
 * Updates a support tier if there are no supporters for that tier
 * @param petitionData New tier data
 * @param requestAuth User auth code
 * @param petitionId Id of the petition
 * @param supportTierId Id of the support tier
 * @returns server code
 */
const patchPetitionTier = async(petitionData: any, requestAuth: string, petitionId: string, supportTierId: string) : Promise<any> => {
    try {
        const conn = await getPool().getConnection();

        // Check the user if authed/ logged in
        const authQuery = 'SELECT `id` FROM `user` WHERE auth_token = ?';
        const [userQueryResult] = await conn.query( authQuery, [requestAuth]);
        if(userQueryResult.length === 0) {
            await conn.release();
            return 403;
        }
        const userId = userQueryResult[0].id;

        // Gets the petition data
        const checkTitleQuery = 'SELECT * FROM `petition` WHERE id = ?'
        const [checkTitleQueryResult] = await conn.query( checkTitleQuery, [petitionId]);
        // Check if the given petition id is valid and that the requester is the owner
        if(checkTitleQueryResult.length === 0) {
            await conn.release();
            return 404;
        }
        if(checkTitleQueryResult[0].owner_id !== userId) {
            await conn.release();
            return 403;
        }


        const checkTierQuery = 'SELECT * FROM `support_tier` WHERE petition_id = ?'
        const [checkTierResult] = await conn.query( checkTierQuery, [petitionId]);
        // check new title is unique in the petition tiers
        if("title" in petitionData) {
            const titles = new Set();
            titles.add(petitionData.title);
            let isUnique = true;
            for(const tier in checkTierResult) {
                if(checkTierResult[tier].id !== supportTierId) {
                    if(titles.has(checkTierResult[tier].title)) {
                        isUnique = false;
                    } else {
                        titles.add(checkTierResult[tier].title);
                    }
                }
            }
            if(!isUnique) {
                await conn.release();
                return 403;
            }
        }

        // Finds tier with given id and no supporters
        const supportTierQuery = "SELECT support_tier.* FROM `support_tier` LEFT join supporter on supporter.support_tier_id = support_tier.id WHERE support_tier.id = ? GROUP BY support_tier.id HAVING COUNT(supporter.support_tier_id) = 0;";
        const [tierQueryResult] = await conn.query( supportTierQuery, [supportTierId]);

        // Check if there is are no tiers returned
        if(tierQueryResult.length === 0) {
            await conn.release();
            return 403;
        }

        // Construct the query with the given variables
        const queryVars = [];
        let query = 'UPDATE `support_tier` SET ';
        let addedVar = false;
        if("title" in petitionData) {
            query = query.concat(`title = ?`);
            addedVar = true;
            queryVars.push(petitionData.title);
        }
        if("description" in petitionData) {
            if(addedVar) {
                query = query.concat(`, `);

            }
            query = query.concat(`description = ?`);
            addedVar = true;
            queryVars.push(petitionData.description);
        }
        if("cost" in petitionData) {
            if(addedVar) {
                query = query.concat(`, `);
            }
            query = query.concat(`cost = ?`);
            addedVar = true;
            queryVars.push(petitionData.cost);
        }

        // Finish the sql query
        query = query.concat(" WHERE id = ?");
        queryVars.push(supportTierId);

        // Updates the petition result and checks if a row was updated
        const [petitionQueryResult] = await conn.query(query, queryVars);
        await conn.release();
        if(petitionQueryResult.affectedRows === 0) {
            return 403; // No row updated
        }


        return 200;


    } catch(err){
        if(err.code === 'ER_DUP_ENTRY') {
            return 403;
        }
        throw error(err);
    }
}

/**
 * Gets info of all the supports of a petition
 * @param petitionId Id of the petition
 * @returns Null if no petition or the supporters data as a list
 */
const getPetitionSupporters = async(petitionId: string) : Promise<any> => {

    const conn = await getPool().getConnection();

    // Checks if there is actually a petition with the given id
    const getPetitionQuery = "SELECT id FROM `petition` WHERE id = ?";
    const [petitionQueryResult] = await conn.query(getPetitionQuery, [petitionId]);
    if(petitionQueryResult.length === 0) {
        await conn.release();
        return null;
    }

    // Gets the list of supports formated nicely
    const getSupportersQuery = "SELECT supporter.id as supportId, support_tier.id as supportTierId, supporter.message, user.id as supporterId, user.first_name as supporterFirstName, user.last_name as supporterLastName, supporter.timestamp FROM `support_tier` JOIN supporter on support_tier.id = supporter.support_tier_id JOIN user on user.id = supporter.user_id JOIN petition on petition.id = support_tier.petition_id WHERE petition.id = ? GROUP BY user.id ORDER BY `supporter`.`timestamp` DESC";
    const [getSupportsResult] = await conn.query(getSupportersQuery, [petitionId]);
    await conn.release();

    return getSupportsResult;
}


/**
 * Populates the User table in the database with the given data. Must be done here instead of within the
 * `resample_database.sql` script because passwords must be hashed according to the particular implementation.
 * @returns {Promise<void>}
 */
const populateDefaultUsers = async (): Promise<void> => {
    const createSQL = 'INSERT INTO `user` (`email`, `first_name`, `last_name`, `image_filename`, `password`) VALUES ?';

    const properties = defaultUsers.properties;
    let usersData = defaultUsers.usersData;

    // Shallow copy all the user arrays within the main data array
    // Ensures that the user arrays with hashed passwords won't persist across multiple calls to this function
    usersData = usersData.map((user: any) => ([...user]));

    const passwordIndex = properties.indexOf('password');
    await Promise.all(usersData.map((user: any) => changePasswordToHash(user, passwordIndex)));

    try {
        await getPool().query(createSQL, [usersData]);
    } catch (err) {
        Logger.error(err.sql);
        throw err;
    }
}

async function changePasswordToHash(user:any, passwordIndex:number) {
    user[passwordIndex] = await passwords.hash(user[passwordIndex]);
}

const executeSql = async (sql: string): Promise<RowDataPacket[][] | RowDataPacket[] | OkPacket | OkPacket[] | ResultSetHeader> => {
    try {
        const [rows] = await getPool().query(sql);
        return rows;
    } catch (err) {
        Logger.error(err.sql);
        throw err;
    }
};

export {resetDb,getPetitionSupporters, addPetitionTierDB, patchPetitionTier, deleteTierFromDB, patchPetition, loadData, executeSql,addPetition, insertNewUser, getCatsFromDB, deletePetFromDB, setPetitionPath, getDetailedPetition, emailInUse, checkLogin, logoutUser, viewUser, patchUser, getImagePath, setImagePath, deleteImagePath, getPetitionFromDB, getCatImagePath}
