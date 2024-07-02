import * as bcrypt from 'bcrypt';

const hash = async (password: string): Promise<string> => {
    // Todo: update this to encrypt the password

    return await bcrypt.hash(password, 10);
}

const compare = async (password: string, comp: string): Promise<boolean> => {
    // Todo: (suggested) update this to compare the encrypted passwords
    return await bcrypt.compare(password, comp);
}

export {hash, compare}