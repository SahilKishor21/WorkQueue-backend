const jwt = require('jsonwebtoken');

const auth = (requiredRole) => {
    return (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ message: 'Unauthorized: Token is missing or improperly formatted' });
            }

            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            req.user = decoded;
            console.log('Decoded Token:', decoded);

            if (requiredRole && decoded.role !== requiredRole) {
                console.warn(`Role mismatch: Expected ${requiredRole}, but got ${decoded.role}`);
                return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
            }

            next();
        } catch (error) {
            console.error('Token verification failed:', error.message);
            return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
        }
    };
};

module.exports = auth;